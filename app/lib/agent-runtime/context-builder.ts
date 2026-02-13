/**
 * Context Builder Service
 *
 * Builds the complete wake-up context for the agent brain.
 * This is the unified entry point for assembling all context data
 * from memory systems, runtime state, and current market conditions.
 *
 * Used by:
 * - QBR Handler (scheduled strategic reviews)
 * - Exception Handler (emergency wake-ups)
 * - Novel Situation Handler (future)
 *
 * Created: 2026-02-06
 */

import { supabase } from '@/lib/supabase';
import type { WakeUpContext, TriggerType, TriggerUrgency } from './wake-up-types';
import type { AgentPolicy } from './types';
import { getRecentIndustryEvents } from './industry-memory';
import {
  getRecentPersonalMemories,
  getPersonalMemoriesByType,
  getImportantLearnings,
} from './personal-memory';
import { PERSONALITY_DEFAULTS, AGENT_COSTS } from './constants';
import type { AgentCostStructure } from './types';
import { calculateTaskCost, calculateAllInCost, calculateBidScore, DEFAULT_LIVING_COST_PER_ROUND } from './autopilot';

/**
 * Build complete wake-up context for an agent
 *
 * Loads all necessary context data in parallel for optimal performance.
 * Returns a structured context object ready for prompt formatting.
 */
export async function buildWakeUpContext(
  agentId: string,
  triggerType: TriggerType,
  triggerDetails: string,
  urgency: TriggerUrgency = 'medium'
): Promise<WakeUpContext> {
  // Load all context data in parallel
  const [
    agent,
    policyData,
    runtimeState,
    recentBids,
    winCount,
    lossCount,
    partnerships,
    industryEvents,
    _personalMemories, // Loaded for potential future use in narrative context
    keyLearnings,
    recentTasks,
  ] = await Promise.all([
    // Agent identity
    supabase.from('agents').select('*').eq('id', agentId).single(),

    // Current policy
    supabase
      .from('agent_policies')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),

    // Runtime state (may be empty for new agents)
    supabase.from('agent_runtime_state').select('*').eq('agent_id', agentId).single(),

    // Recent bid outcomes (last 20 for context)
    supabase
      .from('bids_cache')
      .select('task_id, amount, status, created_at')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(20),

    // Total wins count
    supabase
      .from('bids_cache')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', agentId)
      .eq('status', 'WON'),

    // Total losses count
    supabase
      .from('bids_cache')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', agentId)
      .eq('status', 'LOST'),

    // Active partnerships
    loadPartnerships(agentId),

    // Industry memory (shared market events)
    getRecentIndustryEvents(5),

    // Personal memories (recent history)
    getRecentPersonalMemories(agentId, 10),

    // Key learnings (high-importance insights)
    getImportantLearnings(agentId, 3),

    // Task type distribution (recent 50 tasks for type match rate)
    supabase
      .from('tasks')
      .select('type')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  // Extract data safely
  const agentData = agent.data;
  const policy = (policyData.data?.policy_json || getDefaultPolicy(agentData?.type || 'CATALOG')) as AgentPolicy;
  const state = runtimeState.data;

  // Check for errors in bid fetching
  if (recentBids.error) {
    console.error(`[ERROR] Failed to fetch bids_cache: ${recentBids.error.message}`);
  }
  const bids = recentBids.data || [];

  // DEBUG: Log raw fetch
  console.log(`[DEBUG] Raw bids fetch - error: ${recentBids.error ? recentBids.error.message : 'none'}, data count: ${bids.length}`);
  const partnershipList = partnerships || [];

  // Get behavioral prompt from personality
  const personalityType = agentData?.personality || policy.identity.personality;
  const behavioralPrompt = getBehavioralPrompt(personalityType);

  // Build identity block
  const identity = {
    id: agentData?.id || agentId,
    name: agentData?.name || 'Unknown',
    type: agentData?.type || 'EXECUTOR',
    personality: personalityType,
    balance: agentData?.balance || 0,
    reputation: agentData?.reputation || 0,
    status: agentData?.status || 'ACTIVE',
    behavioral_prompt: behavioralPrompt,
  };

  // Calculate current state metrics
  const currentRound = state?.current_round || 0;
  const totalRevenue = state?.total_revenue || 0;
  const totalCosts = state?.total_costs || 0;
  const profit = totalRevenue - totalCosts;
  const avgCostPerRound = currentRound > 0 ? totalCosts / currentRound : 0.01;
  const runwayRounds = avgCostPerRound > 0 ? Math.floor(identity.balance / avgCostPerRound) : 999;

  // Get total wins/losses from count queries
  const totalWins = winCount.count || 0;
  const totalLosses = lossCount.count || 0;
  const totalBidsAll = totalWins + totalLosses;
  const winRateLifetime = totalBidsAll > 0 ? (totalWins / totalBidsAll) * 100 : 0;

  // Calculate stats from recent 20 bids (for streaks and recent win rate)
  const recentBidStats = calculateBidStats(bids);

  // DEBUG: Detailed logging for win rate diagnosis
  console.log(`[DEBUG] Agent ${agentId} wallet: ${agentData?.wallet_address}`);
  console.log(`[DEBUG] Total bids from bids_cache: ${bids.length}`);
  console.log(`[DEBUG] Bids breakdown - WON: ${bids.filter(b => b.status === 'WON').length}, LOST: ${bids.filter(b => b.status === 'LOST').length}, OTHER: ${bids.filter(b => b.status !== 'WON' && b.status !== 'LOST').length}`);
  console.log(`[DEBUG] Lifetime: ${totalWins} wins, ${totalLosses} losses, rate: ${(winRateLifetime).toFixed(1)}%`);
  console.log(`[DEBUG] Recent 20: wins: ${bids.slice(-20).filter(b => b.status === 'WON').length}, rate: ${(recentBidStats.win_rate_last_20 * 100).toFixed(1)}%`);
  if (recentBidStats.win_rate_last_20 === 0 && totalWins > 0) {
    console.log(`[WARNING] Recent win rate is 0 but agent has ${totalWins} total wins!`);
  }

  // Calculate wins in last 10 rounds (recent trend indicator)
  const last10Bids = [...bids]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10);
  const winsLast10 = last10Bids.filter(b => b.status === 'WON').length;

  const stateBlock = {
    current_round: currentRound,
    total_wins: totalWins,
    total_losses: totalLosses,
    win_rate_lifetime: winRateLifetime,
    consecutive_losses: recentBidStats.consecutive_losses,
    consecutive_wins: recentBidStats.consecutive_wins,
    win_rate_last_20: recentBidStats.win_rate_last_20,
    wins_last_10: winsLast10,
    total_revenue: totalRevenue,
    total_costs: totalCosts,
    profit,
    runway_rounds: runwayRounds,
  };

  // Build economics block (cost awareness)
  // Pass the correct policy from agent_policies table (not agentData which is from agents table)
  const economicsBlock = buildEconomicsBlock(
    agentData,
    stateBlock,
    bids,
    (recentTasks.data || []) as Array<{ type: string }>,
    policy,
  );

  // Build market context
  const marketBlock = await buildMarketContext(agentData?.type || 'CATALOG', bids, agentId);

  // Build narrative summaries
  const situationSummary = buildSituationSummary(
    triggerType,
    triggerDetails,
    stateBlock,
    identity
  );
  const marketNarrative = buildMarketNarrative(marketBlock, industryEvents);

  // Organize personal memories by type
  const bidMemories = await getPersonalMemoriesByType(agentId, 'bid_outcome', 5);
  const partnershipMemories = await getPersonalMemoriesByType(agentId, 'partnership_event', 3);
  const exceptionMemories = await getPersonalMemoriesByType(agentId, 'exception_handled', 3);
  const qbrMemories = await getPersonalMemoriesByType(agentId, 'qbr_insight', 3);

  // Build "since last change" feedback block
  let sinceLastChange: WakeUpContext['since_last_change'] = null;
  if (state?.last_policy_change_round && state.last_policy_change_round > 0 && state.metrics_at_last_change) {
    const roundsAgo = currentRound - state.last_policy_change_round;
    // Count wins/losses from recent bids (proxy for "since policy change")
    const winsSince = bids.filter(b => b.status === 'WON').length;
    const lossesSince = bids.filter(b => b.status === 'LOST').length;

    sinceLastChange = {
      rounds_ago: roundsAgo,
      policy_change_round: state.last_policy_change_round,
      before: state.metrics_at_last_change as any,
      after: {
        win_rate: recentBidStats.win_rate_last_20,
        balance: identity.balance,
        consecutive_losses: recentBidStats.consecutive_losses,
        wins_since: winsSince,
        losses_since: lossesSince,
      },
    };
  }

  // Build wake-up context
  const context: WakeUpContext = {
    identity,
    state: stateBlock,
    market: marketBlock,
    policy,
    situation_summary: situationSummary,
    market_narrative: marketNarrative,
    industry_memories: industryEvents.map((e) => ({
      round_number: e.round_number,
      event_type: e.event_type,
      data: e.data,
      narrative: e.narrative,
      severity: e.severity,
    })),
    personal_memories: {
      recent_bids: bidMemories.map((m) => ({
        round_number: m.round_number,
        data: m.data,
        narrative: m.narrative,
        importance_score: m.importance_score,
      })),
      key_learnings: keyLearnings.map((m) => ({
        round_number: m.round_number,
        data: m.data,
        narrative: m.narrative,
        importance_score: m.importance_score,
      })),
      partnership_history: partnershipMemories.map((m) => ({
        round_number: m.round_number,
        data: m.data,
        narrative: m.narrative,
      })),
      recent_exceptions: exceptionMemories.map((m) => ({
        round_number: m.round_number,
        data: m.data,
        narrative: m.narrative,
      })),
      qbr_insights: qbrMemories.map((m) => ({
        round_number: m.round_number,
        data: m.data,
        narrative: m.narrative,
      })),
    },
    economics: economicsBlock,
    since_last_change: sinceLastChange,
    partnerships: partnershipList,
    trigger: {
      type: triggerType,
      details: triggerDetails,
      urgency,
    },
  };

  return context;
}

/**
 * Format wake-up context into a readable prompt for the LLM
 *
 * Takes the structured context and formats it into markdown sections
 * that the brain can easily understand and reason about.
 */
export function formatContextForPrompt(context: WakeUpContext): string {
  const sections: string[] = [];

  // === AGENT IDENTITY ===
  sections.push(`# AGENT IDENTITY

**Name:** ${context.identity.name}
**Type:** ${context.identity.type}
**Personality:** ${context.identity.personality}
**Status:** ${context.identity.status}

**Behavioral Guidance:**
${context.identity.behavioral_prompt}

**Current Resources:**
- Balance: $${context.identity.balance.toFixed(3)}
- Reputation: ${context.identity.reputation.toFixed(2)}/5
- Runway: ${context.state.runway_rounds} rounds
`);

  // === CURRENT STATE ===
  const winRate = context.state.total_revenue > 0
    ? ((context.state.total_revenue - context.state.total_costs) / context.state.total_revenue * 100).toFixed(1)
    : '0.0';

  sections.push(`# CURRENT STATE

**Round ${context.state.current_round}**

**Performance:**
- Win Rate (Last 20): ${(context.state.win_rate_last_20 * 100).toFixed(1)}%
- Consecutive Wins: ${context.state.consecutive_wins}
- Consecutive Losses: ${context.state.consecutive_losses}

**Financials:**
- Total Revenue: $${context.state.total_revenue.toFixed(3)}
- Total Costs: $${context.state.total_costs.toFixed(3)}
- Profit: $${context.state.profit.toFixed(3)}
- Margin: ${winRate}%
`);

  // === WHY YOU'RE WAKING UP ===
  sections.push(`# WHY YOU'RE WAKING UP

**Trigger:** ${context.trigger.type.toUpperCase()}
**Urgency:** ${context.trigger.urgency.toUpperCase()}

${context.situation_summary}
`);

  // === MARKET CONDITIONS ===
  sections.push(`# MARKET CONDITIONS

${context.market_narrative}

**Market Metrics:**
- Recent Avg Winning Bid (last 5): $${context.market.avg_winning_bid_recent.toFixed(3)}
- Historical Avg Winning Bid: $${context.market.avg_winning_bid.toFixed(3)}
- Price Trend: ${context.market.price_trend}
- Competitor Count: ${context.market.competitor_count}
- Demand Trend: ${context.market.demand_trend}
`);

  // === RECENT INDUSTRY EVENTS ===
  if (context.industry_memories.length > 0) {
    sections.push(`# RECENT INDUSTRY EVENTS

${context.industry_memories
  .map((e) => `**Round ${e.round_number}** [${e.severity}]: ${e.narrative}`)
  .join('\n\n')}
`);
  }

  // === YOUR RECENT HISTORY ===
  sections.push(`# YOUR RECENT HISTORY`);

  if (context.personal_memories.recent_bids.length > 0) {
    sections.push(`## Recent Bid Outcomes

${context.personal_memories.recent_bids
  .map((m) => `**Round ${m.round_number}**: ${m.narrative}`)
  .join('\n')}
`);
  }

  if (context.personal_memories.key_learnings.length > 0) {
    sections.push(`## Key Learnings

${context.personal_memories.key_learnings
  .map((m) => `**Round ${m.round_number}** [importance: ${m.importance_score.toFixed(2)}]: ${m.narrative}`)
  .join('\n\n')}
`);
  }

  if (context.personal_memories.partnership_history.length > 0) {
    sections.push(`## Partnership History

${context.personal_memories.partnership_history
  .map((m) => `**Round ${m.round_number}**: ${m.narrative}`)
  .join('\n')}
`);
  }

  if (context.personal_memories.recent_exceptions.length > 0) {
    sections.push(`## Previous Exceptions Handled

${context.personal_memories.recent_exceptions
  .map((m) => `**Round ${m.round_number}**: ${m.narrative}`)
  .join('\n')}
`);
  }

  if (context.personal_memories.qbr_insights.length > 0) {
    sections.push(`## Previous QBR Insights

${context.personal_memories.qbr_insights
  .map((m) => `**Round ${m.round_number}**: ${m.narrative}`)
  .join('\n')}
`);
  }

  // === CURRENT POLICY ===
  const p = context.policy;
  sections.push(`# CURRENT POLICY

**Bidding Strategy:**
- Target Margin: ${p.bidding?.target_margin !== undefined ? `${Math.round(p.bidding.target_margin * 100)}` : 'not set'} (whole number — set 5 for 5%, 8 for 8%. Higher = less competitive)
- Min Margin: ${p.bidding?.min_margin !== undefined ? `${Math.round(p.bidding.min_margin * 100)}` : 'not set'}
- Skip Below: ${p.bidding?.skip_below !== undefined ? `$${p.bidding.skip_below}` : 'not set'}

**Partnership Rules:**
- Auto-Accept: Min Reputation ${p.partnerships?.auto_accept?.min_reputation !== undefined ? p.partnerships.auto_accept.min_reputation.toFixed(2) : 'not set'}/5, Min Split ${p.partnerships?.auto_accept?.min_split !== undefined ? `${p.partnerships.auto_accept.min_split}%` : 'not set'}
- Auto-Reject: Max Reputation ${p.partnerships?.auto_reject?.max_reputation !== undefined ? p.partnerships.auto_reject.max_reputation.toFixed(2) : 'not set'}/5

**Exception Triggers:**
- Consecutive Losses: ${p.exceptions?.consecutive_losses ?? 'not set'}
- Balance Below: ${p.exceptions?.balance_below !== undefined ? `$${p.exceptions.balance_below}` : 'not set'}
- Reputation Drop: ${p.exceptions?.reputation_drop !== undefined ? p.exceptions.reputation_drop : 'not set'}
- Win Rate Drop: ${p.exceptions?.win_rate_drop_percent !== undefined ? `${p.exceptions.win_rate_drop_percent}%` : 'not set'}

**QBR Frequency:**
- Base: ${p.qbr?.base_frequency_rounds !== undefined ? `Every ${p.qbr.base_frequency_rounds} rounds` : 'not set'}
`);

  // === ACTIVE PARTNERSHIPS ===
  if (context.partnerships.length > 0) {
    sections.push(`# ACTIVE PARTNERSHIPS

${context.partnerships
  .map((p) => `- **${p.partnerName}** (${p.partnerType}): ${p.split}% split, ${(p.jointWinRate * 100).toFixed(1)}% joint win rate`)
  .join('\n')}
`);
  } else {
    sections.push(`# ACTIVE PARTNERSHIPS

No active partnerships.
`);
  }

  return sections.join('\n');
}

/**
 * Build economics block — gives the brain full cost awareness.
 *
 * The brain needs to understand:
 * - Fixed costs it pays every round regardless of winning
 * - Variable costs per task won
 * - How much it actually keeps after investor share
 * - Whether it's on a path to death and how many rounds it has left
 */
function buildEconomicsBlock(
  agentData: any,
  stateBlock: any,
  bids: Array<any>,
  recentTasks: Array<{ type: string }>,
  currentPolicy?: AgentPolicy,
): WakeUpContext['economics'] {
  const agentType = agentData?.type || 'CATALOG';
  const costs: AgentCostStructure = AGENT_COSTS[agentType as keyof typeof AGENT_COSTS] || AGENT_COSTS.CATALOG;
  const investorShareBps = agentData?.investor_share_bps || 7500;
  const investorPct = investorShareBps / 10000;
  const currentRound = stateBlock.current_round || 1;

  // Per-unit costs from cost structure
  const taskCost = calculateTaskCost(costs);
  const bidCostPerBid = costs.per_bid.bid_submission;
  const livingCost = DEFAULT_LIVING_COST_PER_ROUND;
  const brainCostPerWakeup = costs.periodic.brain_wakeup;

  // Actual rates from history
  const totalBidsPlaced = bids.length;
  const totalWins = bids.filter(b => b.status === 'WON').length;
  const bidsPerRound = currentRound > 0 ? totalBidsPlaced / currentRound : 0;
  const winsPerRound = currentRound > 0 ? totalWins / currentRound : 0;

  // Brain wakeup rate
  const totalBrainWakeups = stateBlock.total_brain_wakeups || 0;
  const brainWakeupRate = currentRound > 0 ? totalBrainWakeups / currentRound : 0.3;
  const brainCostAmortized = brainCostPerWakeup * brainWakeupRate;

  // Fixed cost per round (paid regardless of winning)
  const fixedCostPerRound = livingCost + brainCostAmortized;

  // Type match rate — what fraction of tasks match this agent's type
  const matchingTasks = recentTasks.filter(t => t.type === agentType).length;
  const typeMatchRate = recentTasks.length > 0 ? matchingTasks / recentTasks.length : 0.33;

  // Win economics
  const winningBids = bids.filter(b => b.status === 'WON');
  const avgRevenuePerWin = winningBids.length > 0
    ? winningBids.reduce((s, b) => s + parseFloat(b.amount), 0) / winningBids.length
    : 0;
  const avgProfitPerWin = avgRevenuePerWin - taskCost; // gross profit before investor
  const avgAgentTakePerWin = avgProfitPerWin > 0 ? avgProfitPerWin * (1 - investorPct) : avgProfitPerWin;

  // Survival math
  const avgBidCostPerRound = bidsPerRound * bidCostPerBid;
  const avgRevPerRound = winsPerRound * avgAgentTakePerWin;
  const netPerRound = avgRevPerRound - fixedCostPerRound - avgBidCostPerRound;

  const balance = agentData?.balance || 0;
  const roundsUntilDeath = netPerRound < 0 ? Math.floor(balance / Math.abs(netPerRound)) : 999;
  const breakEvenWinsPerRound = avgAgentTakePerWin > 0
    ? (fixedCostPerRound + avgBidCostPerRound) / avgAgentTakePerWin
    : 999;

  // Minimum profitable bid = per-task variable-cost floor.
  // EconomyService takes investor share on NET profit (bid - allInCost), not GROSS.
  // Near the floor, netProfit < 0, so investor gets $0.
  // Agent per-task contribution = agentShare - bidCost = (bid - taskCost) - bidCost.
  // Break-even: bid = taskCost + bidCost (investor share is irrelevant at the floor).
  // Fixed costs (living, brain) are per-round, covered by break_even_wins_per_round.
  const minProfitableBid = taskCost + bidCostPerBid;

  // Calculate allInCost — the actual base used by autopilot for bid calculation
  const allInCost = calculateAllInCost(costs, investorShareBps, livingCost);

  // Get the agent's current policy margins for bid feedback calculation
  // Use the correct policy from agent_policies table (passed in), NOT agentData (agents table)
  const personalityKey = agentData?.personality || currentPolicy?.identity?.personality || 'balanced';
  const personalityDefaultMargin = PERSONALITY_DEFAULTS[personalityKey]?.bidding?.target_margin ?? 0.20;
  const targetMargin = currentPolicy?.bidding?.target_margin ?? personalityDefaultMargin;
  const bidAtTargetMargin = allInCost / (1 - targetMargin);

  // Last actual bid and its score
  const mostRecentBid = bids.length > 0
    ? [...bids].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
    : null;
  const lastBidAmount = mostRecentBid ? parseFloat(mostRecentBid.amount) : 0;
  const agentReputation = agentData?.reputation || 0;
  const lastBidScore = lastBidAmount > 0 ? calculateBidScore(agentReputation, lastBidAmount) : 0;

  return {
    fixed_cost_per_round: fixedCostPerRound,
    living_cost: livingCost,
    brain_cost_amortized: brainCostAmortized,
    bid_cost_per_bid: bidCostPerBid,
    task_cost: taskCost,
    investor_share_pct: investorPct * 100,

    avg_revenue_per_win: avgRevenuePerWin,
    avg_profit_per_win: avgProfitPerWin,
    avg_agent_take_per_win: avgAgentTakePerWin,
    wins_per_round: winsPerRound,
    bids_per_round: bidsPerRound,
    type_match_rate: typeMatchRate,

    min_profitable_bid: minProfitableBid,
    all_in_cost: allInCost,
    net_per_round: netPerRound,
    rounds_until_death: roundsUntilDeath,
    break_even_wins_per_round: breakEvenWinsPerRound,

    // Bid feedback
    your_last_bid: lastBidAmount,
    your_last_bid_score: lastBidScore,
    your_bid_at_target_margin: bidAtTargetMargin,

    total_living_costs: currentRound * livingCost,
    total_brain_costs: totalBrainWakeups * brainCostPerWakeup,
    total_bid_costs: totalBidsPlaced * bidCostPerBid,
    total_task_costs: totalWins * taskCost,
    total_investor_share: totalWins * (avgProfitPerWin > 0 ? avgProfitPerWin * investorPct : 0),
  };
}

/**
 * Load active partnerships for an agent
 */
async function loadPartnerships(agentId: string): Promise<Array<{
  partnerId: string;
  partnerName: string;
  partnerType: string;
  split: number;
  jointWinRate: number;
}>> {
  try {
    const { data: agent } = await supabase
      .from('agents')
      .select('wallet_address')
      .eq('id', agentId)
      .single();

    if (!agent?.wallet_address) {
      return [];
    }

    const { data: partnerships } = await supabase
      .from('partnerships_cache')
      .select('*')
      .or(`partner_a_wallet.eq.${agent.wallet_address},partner_b_wallet.eq.${agent.wallet_address}`)
      .eq('status', 'ACTIVE');

    if (!partnerships || partnerships.length === 0) {
      return [];
    }

    // For now, return simplified partnership data
    // TODO: Calculate joint win rate from bids_cache
    return partnerships.map((p: any) => ({
      partnerId: p.partner_a_wallet === agent.wallet_address ? p.partner_b_wallet : p.partner_a_wallet,
      partnerName: p.partner_a_wallet === agent.wallet_address ? p.partner_b_wallet : p.partner_a_wallet,
      partnerType: 'AGENT',
      split: p.partner_a_wallet === agent.wallet_address ? p.split_a : p.split_b,
      jointWinRate: 0, // TODO: Calculate from actual data
    }));
  } catch (error) {
    console.error('[Context Builder] Error loading partnerships:', error);
    return [];
  }
}

/**
 * Build market context from MARKET-WIDE data (all agents, not just self).
 *
 * IMPORTANT: Before this fix, the "market average" was computed from the
 * agent's OWN bids only, causing self-referential comparisons like
 * "my bid is 52% higher than market" when the real gap was ~6%.
 *
 * Now queries ALL winning bids for this task type across ALL agents.
 */
async function buildMarketContext(
  agentType: string,
  _recentBids: Array<any>,  // kept for signature compat, no longer used for market avg
  currentAgentId: string,
): Promise<WakeUpContext['market']> {
  // ---------------------------------------------------------------
  // Market-wide winning bids for this task type (ALL agents)
  // Join via tasks table to filter by type
  // ---------------------------------------------------------------
  const { data: recentTasks } = await supabase
    .from('tasks')
    .select('id')
    .eq('type', agentType)
    .eq('status', 'COMPLETED')
    .order('created_at', { ascending: false })
    .limit(10);

  const taskIds = (recentTasks || []).map(t => t.id);

  let marketWinningBids: Array<{ amount: string | number; created_at: string }> = [];
  if (taskIds.length > 0) {
    const { data: wonBids } = await supabase
      .from('bids_cache')
      .select('amount, created_at')
      .in('task_id', taskIds)
      .eq('status', 'WON')
      .order('created_at', { ascending: false });
    marketWinningBids = wonBids || [];
  }

  // Historical average (all winning bids for this task type)
  const avgWinningBidAll = marketWinningBids.length > 0
    ? marketWinningBids.reduce((sum, b) => sum + parseFloat(String(b.amount)), 0) / marketWinningBids.length
    : 0;

  // Recent average (last 5 winning bids — most relevant for current pricing)
  const recentMarketWins = marketWinningBids.slice(0, 5);
  const avgWinningBidRecent = recentMarketWins.length > 0
    ? recentMarketWins.reduce((sum, b) => sum + parseFloat(String(b.amount)), 0) / recentMarketWins.length
    : avgWinningBidAll;

  // Detect price trend: compare last 5 wins to overall history
  let priceTrend = 'stable';
  if (marketWinningBids.length >= 6 && recentMarketWins.length >= 3) {
    const ratio = avgWinningBidRecent / avgWinningBidAll;
    if (ratio > 1.10) priceTrend = 'rising';
    else if (ratio < 0.90) priceTrend = 'falling';
  }

  // ---------------------------------------------------------------
  // Competitor data (same type, active, excluding self)
  // ---------------------------------------------------------------
  const { data: competitors } = await supabase
    .from('agents')
    .select('id, name, balance, status')
    .eq('type', agentType)
    .in('status', ['ACTIVE', 'LOW_FUNDS'])
    .neq('id', currentAgentId);

  const competitorCount = (competitors?.length || 0) + 1; // +1 for self

  // Build competitor health snapshot
  const competitorHealth: WakeUpContext['market']['competitor_health'] = [];
  if (competitors && competitors.length > 0) {
    for (const comp of competitors.slice(0, 5)) {
      const { data: compBids } = await supabase
        .from('bids_cache')
        .select('status, amount')
        .eq('agent_id', comp.id)
        .order('created_at', { ascending: false })
        .limit(10);

      const allBids = compBids || [];
      const wonBids = allBids.filter(b => b.status === 'WON');
      const total = allBids.filter(b => b.status === 'WON' || b.status === 'LOST').length;

      // Use average WINNING bid (more actionable than avg of all bids).
      // Fall back to all bids if no wins.
      const bidsForAvg = wonBids.length > 0 ? wonBids : allBids;
      const avgBid = bidsForAvg.length > 0
        ? bidsForAvg.reduce((s, b) => s + parseFloat(b.amount || '0'), 0) / bidsForAvg.length
        : 0;

      // Get competitor reputation for scoring context
      const { data: compFull } = await supabase
        .from('agents')
        .select('reputation')
        .eq('id', comp.id)
        .single();
      const compReputation = compFull?.reputation || 0;
      const compBidScore = avgBid > 0 ? calculateBidScore(compReputation, avgBid) : 0;

      let balanceStatus: 'healthy' | 'low' | 'critical' = 'healthy';
      if (comp.balance < 0.1) balanceStatus = 'critical';
      else if (comp.balance < 0.3) balanceStatus = 'low';

      competitorHealth.push({
        name: comp.name,
        balance: comp.balance || 0,
        balance_status: balanceStatus,
        win_rate: total > 0 ? wonBids.length / total : 0,
        avg_bid: avgBid,
        reputation: compReputation,
        bid_score: compBidScore,
      });
    }
  }

  // ---------------------------------------------------------------
  // Demand trend: compare recent 5 rounds of task volume to previous 5
  // ---------------------------------------------------------------
  let demandTrend = 'stable';
  const { data: allRecentTasks } = await supabase
    .from('tasks')
    .select('created_at')
    .eq('type', agentType)
    .order('created_at', { ascending: false })
    .limit(100);

  if (allRecentTasks && allRecentTasks.length >= 10) {
    // Split by time midpoint (not count midpoint) to detect volume changes
    const timestamps = allRecentTasks.map(t => new Date(t.created_at).getTime());
    const midTime = (timestamps[0] + timestamps[timestamps.length - 1]) / 2;
    const recentCount = timestamps.filter(t => t >= midTime).length;
    const olderCount = timestamps.filter(t => t < midTime).length;
    if (olderCount > 0 && recentCount > olderCount * 1.2) demandTrend = 'increasing';
    else if (recentCount > 0 && recentCount < olderCount * 0.8) demandTrend = 'declining';
  }

  // Price compression: % change from historical to recent
  const priceCompression = avgWinningBidAll > 0
    ? ((avgWinningBidRecent - avgWinningBidAll) / avgWinningBidAll) * 100
    : 0;

  return {
    avg_winning_bid: avgWinningBidAll,
    avg_winning_bid_recent: avgWinningBidRecent,
    price_trend: priceTrend,
    competitor_count: competitorCount,
    demand_trend: demandTrend,
    price_compression: priceCompression,
    competitor_health: competitorHealth,
  };
}

/**
 * Build situation summary explaining why brain is waking
 */
function buildSituationSummary(
  triggerType: TriggerType,
  triggerDetails: string,
  state: any,
  identity: any
): string {
  switch (triggerType) {
    case 'qbr':
      return `It's time for your scheduled Quarterly Business Review (QBR). You've completed ${state.current_round} rounds and need to evaluate your strategic direction. ${triggerDetails}`;

    case 'exception':
      return `An exception condition has been triggered that requires your immediate attention. ${triggerDetails}. Current balance: $${identity.balance.toFixed(3)}, Consecutive losses: ${state.consecutive_losses}.`;

    case 'novel':
      return `You've encountered a novel situation that the autopilot cannot handle. ${triggerDetails}. This requires your strategic judgment.`;

    case 'initial':
      return `You're being initialized for the first time. Welcome to the Agent-Owned Commerce Protocol! ${triggerDetails}`;

    default:
      return triggerDetails;
  }
}

/**
 * Build market narrative from market data and industry events
 */
function buildMarketNarrative(
  market: any,
  industryEvents: Array<any>
): string {
  const parts: string[] = [];

  // Describe current market state
  if (market.demand_trend === 'increasing') {
    parts.push('The market is experiencing increased demand for tasks.');
  } else if (market.demand_trend === 'declining') {
    parts.push('The market is seeing reduced task volume.');
  } else {
    parts.push('The market is currently stable.');
  }

  // Describe price trends
  if (market.price_compression > 0.1) {
    parts.push('Bidding has become more competitive with prices being driven down.');
  } else if (market.price_compression < -0.1) {
    parts.push('Bid prices are increasing, suggesting reduced competition or higher demand.');
  }

  // Highlight critical industry events
  const criticalEvents = industryEvents.filter((e) => e.severity === 'critical' || e.severity === 'high');
  if (criticalEvents.length > 0) {
    parts.push(`Recent significant events: ${criticalEvents.map((e) => e.event_type).join(', ')}.`);
  }

  return parts.join(' ');
}

/**
 * Calculate accurate bid statistics from bids_cache
 * FIX: bids_cache uses 'status' field ("WON" or "LOST"), not 'won' boolean
 * Now we calculate directly from actual bid data with correct column names
 */
function calculateBidStats(bids: Array<any>): {
  total_wins: number;
  total_losses: number;
  win_rate_lifetime: number;
  consecutive_wins: number;
  consecutive_losses: number;
  win_rate_last_20: number;
} {
  if (!bids || bids.length === 0) {
    return {
      total_wins: 0,
      total_losses: 0,
      win_rate_lifetime: 0,
      consecutive_wins: 0,
      consecutive_losses: 0,
      win_rate_last_20: 0,
    };
  }

  // Sort by created_at to ensure chronological order
  const sortedBids = [...bids].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // Calculate total wins and losses (bids_cache uses status field: "WON" or "LOST")
  const totalWins = sortedBids.filter(b => b.status === 'WON').length;
  const totalLosses = sortedBids.filter(b => b.status === 'LOST').length;
  const totalBids = totalWins + totalLosses;

  // Calculate lifetime win rate
  const winRateLifetime = totalBids > 0 ? totalWins / totalBids : 0;

  // Calculate win rate for last 20 bids
  const last20 = sortedBids.slice(-20);
  const last20Wins = last20.filter(b => b.status === 'WON').length;
  const winRateLast20 = last20.length > 0 ? last20Wins / last20.length : 0;

  // Calculate consecutive wins/losses (from most recent)
  let consecutiveWins = 0;
  let consecutiveLosses = 0;

  for (let i = sortedBids.length - 1; i >= 0; i--) {
    if (sortedBids[i].status === 'WON') {
      consecutiveWins++;
      // Reset if streak breaks
      if (consecutiveLosses > 0) break;
    } else if (sortedBids[i].status === 'LOST') {
      consecutiveLosses++;
      // Reset if streak breaks
      if (consecutiveWins > 0) break;
    }
  }

  // Return win rates as 0-1 values (multiply by 100 only at display time)
  return {
    total_wins: totalWins,
    total_losses: totalLosses,
    win_rate_lifetime: winRateLifetime,
    consecutive_wins: consecutiveWins,
    consecutive_losses: consecutiveLosses,
    win_rate_last_20: winRateLast20,
  };
}

/**
 * Get behavioral prompt for personality type
 */
function getBehavioralPrompt(personality: string): string {
  const prompts: Record<string, string> = {
    'risk-taker': 'You embrace risk and chase high-reward opportunities. You believe fortune favors the bold and are willing to take aggressive positions to maximize growth, even if it means higher volatility.',
    'conservative': 'You prioritize stability and capital preservation. You prefer steady, predictable growth over risky ventures and will walk away from opportunities that don\'t meet your risk criteria.',
    'profit-maximizer': 'You are laser-focused on maximizing profit margins. Every decision is evaluated through the lens of profitability. You seek efficient operations and favorable terms in all dealings.',
    'volume-chaser': 'You believe in the power of volume and market share. You\'re willing to accept thinner margins to capture more market share and build a larger operation.',
    'opportunist': 'You are adaptable and opportunistic. You look for market inefficiencies and favorable conditions, adjusting your strategy based on what the market offers.',
    'partnership-oriented': 'You believe in the power of collaboration. You seek mutually beneficial partnerships and value long-term relationships over short-term gains.',
  };

  return prompts[personality] || prompts['profit-maximizer'];
}

/**
 * Get default policy for agent type
 */
function getDefaultPolicy(_agentType: string): AgentPolicy {
  // Default to profit-maximizer personality (could use agentType in future)
  return PERSONALITY_DEFAULTS['profit-maximizer'];
}
