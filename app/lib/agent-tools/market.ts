/**
 * Market Intelligence Tools
 *
 * Provides agents with read-only access to market conditions, competitive landscape,
 * and historical data for informed decision-making during QBR and strategic planning.
 *
 * Updated to use comprehensive market intelligence with REAL win rates.
 *
 * Tools in this module:
 * - query_market: Analyze market competition for a specific agent type
 * - query_agent: Get potential partners (different type agents)
 * - getMyPosition: Get agent's position relative to the market
 * - getMarketHealth: Get overall market health metrics
 * - getFullMarketIntelligence: Complete market intelligence for an agent
 */

import { supabase } from "@/lib/supabase";
import { AGENT_COSTS } from "@/lib/agent-runtime/constants";
import {
  calculateAllInCost,
  calculateBidScore,
  DEFAULT_LIVING_COST_PER_ROUND,
} from "@/lib/agent-runtime/autopilot";

// Derive all-in costs from the single source of truth (AGENT_COSTS)
// This is the ONLY cost number the brain sees — no separate task_cost to confuse it
const ALL_IN_COSTS: Record<string, number> = Object.fromEntries(
  Object.entries(AGENT_COSTS).map(([type, costs]) => [type, calculateAllInCost(costs, 7500, DEFAULT_LIVING_COST_PER_ROUND)])
);

// =============================================================================
// HELPER: Get real win rate from bids_cache
// =============================================================================

async function getAgentBidStats(agentId: string): Promise<{
  total_bids: number;
  won: number;
  lost: number;
  win_rate: number;
  avg_bid: number;
  consecutive_losses: number;
}> {
  const { data: bids } = await supabase
    .from("bids_cache")
    .select("status, amount, created_at")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false });

  if (!bids || bids.length === 0) {
    return { total_bids: 0, won: 0, lost: 0, win_rate: 0, avg_bid: 0, consecutive_losses: 0 };
  }

  const won = bids.filter(b => b.status === "WON").length;
  const lost = bids.filter(b => b.status === "LOST").length;
  const total = won + lost;
  // Use last 10 bids for avg_bid (recent behavior, not stale lifetime average)
  const last10 = bids.slice(0, 10);
  const avgBid = last10.reduce((sum, b) => sum + (b.amount || 0), 0) / last10.length;

  // Count consecutive losses from most recent
  let consecutiveLosses = 0;
  for (const bid of bids) {
    if (bid.status === "LOST") consecutiveLosses++;
    else break;
  }

  return {
    total_bids: total,
    won,
    lost,
    win_rate: total > 0 ? won / total : 0,
    avg_bid: avgBid,
    consecutive_losses: consecutiveLosses,
  };
}

// =============================================================================
// QUERY MARKET - Comprehensive market intelligence
// =============================================================================

export interface QueryMarketInput {
  agent_type: string;
  agent_id?: string;  // Optional: include to get your position in this market
  time_window_rounds?: number;
}

export interface QueryMarketOutput {
  // Competitor intelligence (same type agents)
  competitors: {
    count: number;
    avg_bid: number;
    winning_bid_avg: number;
    winning_bid_range: { min: number; max: number };
    top_competitors: Array<{
      name: string;
      win_rate: number;
      avg_bid: number;
      tasks_won: number;
    }>;
    bid_pressure_trend: 'increasing' | 'stable' | 'decreasing';
  };

  // Market-wide stats
  market: {
    total_agents_this_type: number;
    total_tasks_completed: number;
    all_in_cost: number;
    demand_trend: 'growing' | 'stable' | 'shrinking';
    // Overall market health (across all types)
    total_agents?: number;
    active_agents?: number;
    agent_survival_rate?: number;
  };

  // Your position in this market (only if agent_id provided)
  my_position?: {
    win_rate: number;
    win_rate_rank: number;           // 1 = best in market
    total_bids: number;
    total_wins: number;
    avg_bid: number;                 // HISTORICAL avg (includes old bids)
    current_bid_at_policy: number;   // CURRENT bid = allInCost / (1 - target_margin)
    current_bid_score: number;       // Auction score at current bid
    all_in_cost: number;             // Bid base: task + bid + living + brain
    avg_bid_vs_market: number;       // >1 means you bid higher than average
    market_share: number;            // your wins / total tasks
    consecutive_losses: number;
    balance_runway: number;          // estimated rounds until death
  };

  // Human-readable analysis
  analysis: string;
}

/**
 * Query market conditions for a specific agent type
 * Returns competitor analysis, market health metrics, and optionally your position
 *
 * @param input.agent_type - The agent type to analyze (CATALOG, REVIEW, etc.)
 * @param input.agent_id - Optional: Your agent ID to include your position in the market
 */
export async function queryMarket(input: QueryMarketInput): Promise<QueryMarketOutput> {
  const { agent_type, agent_id } = input;

  // Get all agents of this type (competitors)
  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, type, status")
    .eq("type", agent_type)
    .in("status", ["ACTIVE", "LOW_FUNDS"]);

  const competitorCount = agents?.length || 0;

  // Get bid stats for each competitor
  const competitorStats = await Promise.all(
    (agents || []).map(async (a) => {
      const stats = await getAgentBidStats(a.id);
      return { id: a.id, name: a.name, ...stats };
    })
  );

  // Calculate competitor averages
  const biddingAgents = competitorStats.filter(c => c.total_bids > 0);
  const avgBid = biddingAgents.length > 0
    ? biddingAgents.reduce((sum, c) => sum + c.avg_bid, 0) / biddingAgents.length
    : 0;

  // Get winning bids for this type (last 10 for relevant averages)
  const { data: completedTasks } = await supabase
    .from("tasks")
    .select("winning_bid_id")
    .eq("type", agent_type)
    .eq("status", "COMPLETED")
    .not("winning_bid_id", "is", null)
    .order("completed_at", { ascending: false })
    .limit(10);

  let winningBidAvg = 0;
  let winningBidMin = 0;
  let winningBidMax = 0;

  if (completedTasks && completedTasks.length > 0) {
    const bidIds = completedTasks.map(t => t.winning_bid_id).filter(Boolean);
    const { data: winningBids } = await supabase
      .from("bids_cache")
      .select("amount")
      .in("id", bidIds);

    const amounts = (winningBids || []).map(b => b.amount || 0).filter(a => a > 0);
    if (amounts.length > 0) {
      winningBidAvg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      winningBidMin = Math.min(...amounts);
      winningBidMax = Math.max(...amounts);
    }
  }

  // Top 3 competitors by win rate (minimum 5 bids to qualify)
  const topCompetitors = competitorStats
    .filter(c => c.total_bids >= 5)
    .sort((a, b) => b.win_rate - a.win_rate)
    .slice(0, 3)
    .map(c => ({
      name: c.name,
      win_rate: c.win_rate,
      avg_bid: c.avg_bid,
      tasks_won: c.won,
    }));

  // Bid pressure trend
  let bidPressureTrend: 'increasing' | 'stable' | 'decreasing' = 'stable';
  if (completedTasks && completedTasks.length >= 10) {
    const bidIds = completedTasks.map(t => t.winning_bid_id).filter(Boolean);
    const { data: orderedBids } = await supabase
      .from("bids_cache")
      .select("amount, created_at")
      .in("id", bidIds)
      .order("created_at", { ascending: false });

    if (orderedBids && orderedBids.length >= 10) {
      const recentAvg = orderedBids.slice(0, 5).reduce((s, b) => s + (b.amount || 0), 0) / 5;
      const olderAvg = orderedBids.slice(5, 10).reduce((s, b) => s + (b.amount || 0), 0) / 5;
      if (recentAvg < olderAvg * 0.95) bidPressureTrend = 'decreasing';
      else if (recentAvg > olderAvg * 1.05) bidPressureTrend = 'increasing';
    }
  }

  // All-in cost (the ONLY cost base the brain should see)
  const allInCost = ALL_IN_COSTS[agent_type] || 0.070;

  // Demand trend
  const { count: recentTasks } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("type", agent_type)
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  const { count: olderTasks } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("type", agent_type)
    .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .gte("created_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());

  let demandTrend: 'growing' | 'stable' | 'shrinking' = 'stable';
  if ((olderTasks || 0) > 0) {
    const ratio = (recentTasks || 0) / (olderTasks || 1);
    if (ratio > 1.2) demandTrend = 'growing';
    else if (ratio < 0.8) demandTrend = 'shrinking';
  }

  // Get overall market health stats
  const { count: totalAgents } = await supabase
    .from("agents")
    .select("id", { count: "exact", head: true });

  const { count: activeAgents } = await supabase
    .from("agents")
    .select("id", { count: "exact", head: true })
    .in("status", ["ACTIVE", "LOW_FUNDS"]);

  const agentSurvivalRate = (totalAgents || 0) > 0
    ? (activeAgents || 0) / (totalAgents || 1)
    : 1;

  // Calculate my_position if agent_id provided
  let myPosition: QueryMarketOutput['my_position'] = undefined;

  if (agent_id) {
    // Find my stats in the already-fetched competitor stats
    const myStats = competitorStats.find(c => c.id === agent_id);

    if (myStats) {
      // Calculate my rank (sorted by win rate, 1 = best)
      const sortedByWinRate = [...competitorStats]
        .filter(c => c.total_bids >= 3) // Need some bids to rank
        .sort((a, b) => b.win_rate - a.win_rate);
      const myRank = sortedByWinRate.findIndex(c => c.id === agent_id) + 1;

      // Calculate market share
      const { count: totalTasksForType } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("type", agent_type)
        .eq("status", "COMPLETED");

      const marketShare = (totalTasksForType || 0) > 0
        ? myStats.won / (totalTasksForType || 1)
        : 0;

      // Get my agent's data for runway and bid economics
      const { data: myAgent } = await supabase
        .from("agents")
        .select("balance, investor_share_bps, reputation")
        .eq("id", agent_id)
        .single();

      const balanceRunway = (myAgent?.balance || 0) > 0
        ? Math.floor((myAgent?.balance || 0) / DEFAULT_LIVING_COST_PER_ROUND)
        : 0;

      // Compute current bid economics from policy (single source of truth)
      const myCostStructure = AGENT_COSTS[agent_type as keyof typeof AGENT_COSTS] || AGENT_COSTS.CATALOG;
      const myAllInCost = calculateAllInCost(myCostStructure, myAgent?.investor_share_bps || 7500, DEFAULT_LIVING_COST_PER_ROUND);
      const { data: myPolicyData } = await supabase
        .from("agent_policies")
        .select("policy_json")
        .eq("agent_id", agent_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      const myPolicy = (myPolicyData?.policy_json || {}) as Record<string, any>;
      const myTargetMargin = myPolicy.bidding?.target_margin ?? 0.15;
      const myCurrentBid = myAllInCost / (1 - myTargetMargin);

      myPosition = {
        win_rate: myStats.win_rate,
        win_rate_rank: myRank || competitorCount + 1,
        total_bids: myStats.total_bids,
        total_wins: myStats.won,
        avg_bid: myStats.avg_bid,
        current_bid_at_policy: myCurrentBid,
        current_bid_score: calculateBidScore(myAgent?.reputation || 0, myCurrentBid),
        all_in_cost: myAllInCost,
        avg_bid_vs_market: winningBidAvg > 0 ? myStats.avg_bid / winningBidAvg : 1,
        market_share: Math.round(marketShare * 10000) / 10000,
        consecutive_losses: myStats.consecutive_losses,
        balance_runway: balanceRunway,
      };
    }
  }

  // Build analysis string
  const analysis = buildMarketAnalysis({
    agent_type,
    competitorCount,
    topCompetitors,
    winningBidAvg,
    winningBidMin,
    winningBidMax,
    bidPressureTrend,
    demandTrend,
    allInCost,
    myPosition,
  });

  return {
    competitors: {
      count: competitorCount,
      avg_bid: Math.round(avgBid * 10000) / 10000,
      winning_bid_avg: Math.round(winningBidAvg * 10000) / 10000,
      winning_bid_range: {
        min: Math.round(winningBidMin * 10000) / 10000,
        max: Math.round(winningBidMax * 10000) / 10000,
      },
      top_competitors: topCompetitors,
      bid_pressure_trend: bidPressureTrend,
    },
    market: {
      total_agents_this_type: competitorCount,
      total_tasks_completed: completedTasks?.length || 0,
      all_in_cost: allInCost,
      demand_trend: demandTrend,
      total_agents: totalAgents || 0,
      active_agents: activeAgents || 0,
      agent_survival_rate: Math.round(agentSurvivalRate * 1000) / 1000,
    },
    my_position: myPosition,
    analysis,
  };
}

function buildMarketAnalysis(data: {
  agent_type: string;
  competitorCount: number;
  topCompetitors: Array<{ name: string; win_rate: number; avg_bid: number }>;
  winningBidAvg: number;
  winningBidMin: number;
  winningBidMax: number;
  bidPressureTrend: string;
  demandTrend: string;
  allInCost: number;
  myPosition?: QueryMarketOutput['my_position'];
}): string {
  const parts: string[] = [];

  // Competition level
  if (data.competitorCount <= 2) {
    parts.push(`Low competition in ${data.agent_type} market with only ${data.competitorCount} active agents.`);
  } else if (data.competitorCount <= 5) {
    parts.push(`Moderate competition in ${data.agent_type} market with ${data.competitorCount} active agents.`);
  } else {
    parts.push(`High competition in ${data.agent_type} market with ${data.competitorCount} active agents.`);
  }

  // Top competitor
  if (data.topCompetitors.length > 0) {
    const top = data.topCompetitors[0];
    parts.push(`${top.name} leads with ${(top.win_rate * 100).toFixed(0)}% win rate at $${top.avg_bid.toFixed(4)} avg bid.`);
  }

  // Winning bid range
  if (data.winningBidAvg > 0) {
    parts.push(`Winning bids range from $${data.winningBidMin.toFixed(4)} to $${data.winningBidMax.toFixed(4)} (avg $${data.winningBidAvg.toFixed(4)}).`);
  }

  // Task cost reference
  parts.push(`Your cost (bid base): $${data.allInCost.toFixed(4)}.`);

  // Trends
  if (data.bidPressureTrend === 'decreasing') {
    parts.push(`Bid prices are DECREASING - competition intensifying.`);
  } else if (data.bidPressureTrend === 'increasing') {
    parts.push(`Bid prices are INCREASING - less competition pressure.`);
  }

  if (data.demandTrend === 'growing') {
    parts.push(`Task demand is GROWING.`);
  } else if (data.demandTrend === 'shrinking') {
    parts.push(`Task demand is SHRINKING.`);
  }

  // My position (if provided)
  if (data.myPosition) {
    const pos = data.myPosition;
    parts.push(`YOUR POSITION: Rank #${pos.win_rate_rank} of ${data.competitorCount} with ${(pos.win_rate * 100).toFixed(0)}% win rate.`);
    if (pos.current_bid_at_policy > 0) {
      parts.push(`Your CURRENT bid at policy: $${pos.current_bid_at_policy.toFixed(4)} (score: ${pos.current_bid_score?.toFixed(0) || 'N/A'}). Historical avg bid: $${pos.avg_bid.toFixed(4)}.`);
    }
    if (pos.avg_bid_vs_market > 1.1) {
      parts.push(`Your historical avg bid is ${((pos.avg_bid_vs_market - 1) * 100).toFixed(0)}% HIGHER than market avg.`);
    } else if (pos.avg_bid_vs_market < 0.9) {
      parts.push(`Your historical avg bid is ${((1 - pos.avg_bid_vs_market) * 100).toFixed(0)}% LOWER than market avg.`);
    }
    if (pos.consecutive_losses >= 3) {
      parts.push(`WARNING: ${pos.consecutive_losses} consecutive losses.`);
    }
    if (pos.balance_runway < 20) {
      parts.push(`CRITICAL: Only ~${pos.balance_runway} rounds of runway left.`);
    }
  }

  return parts.join(' ');
}

// =============================================================================
// QUERY AGENT - Find potential partners (different type)
// =============================================================================

export interface QueryAgentInput {
  min_reputation?: number;
  min_win_rate?: number;
  agent_type?: string;
  current_agent_type?: string;
  exclude_current_partners?: boolean;
  limit?: number;
}

export interface QueryAgentOutput {
  agents: Array<{
    id: string;
    name: string;
    type: string;
    reputation: number;
    win_rate: number;
    delivery_rate: number;
    balance: number;
    balance_health: 'healthy' | 'low' | 'critical';
    tasks_won: number;
    avg_bid: number;
    partnership_count: number;
  }>;
  total_count: number;
}

/**
 * Query agents for partnership candidates
 * Returns agents of DIFFERENT type with their real metrics
 */
export async function queryAgent(input: QueryAgentInput): Promise<QueryAgentOutput> {
  const {
    min_reputation = 3,
    min_win_rate = 0.1,
    current_agent_type,
    limit = 10,
  } = input;

  // Build query for agents of different types
  let query = supabase
    .from("agents")
    .select("*")
    .in("status", ["ACTIVE", "LOW_FUNDS"])
    .gte("reputation", min_reputation);

  // Exclude same type (partners should be different type)
  if (current_agent_type) {
    query = query.neq("type", current_agent_type);
  }

  const { data: agents } = await query.limit(limit * 2);

  if (!agents || agents.length === 0) {
    return { agents: [], total_count: 0 };
  }

  // Enrich with real bid stats
  const enriched = await Promise.all(
    agents.map(async (a) => {
      const bidStats = await getAgentBidStats(a.id);

      // Get partnership count
      const { count: partnershipCount } = await supabase
        .from("partnerships_cache")
        .select("id", { count: "exact", head: true })
        .or(`agent1_id.eq.${a.id},agent2_id.eq.${a.id}`)
        .eq("status", "ACTIVE");

      // Calculate delivery rate
      const tasksWon = a.tasks_completed + a.tasks_failed;
      const deliveryRate = tasksWon > 0 ? a.tasks_completed / tasksWon : 1;

      // Determine balance health
      let balanceHealth: 'healthy' | 'low' | 'critical' = 'healthy';
      if (a.balance < 0.1) balanceHealth = 'critical';
      else if (a.balance < 0.3) balanceHealth = 'low';

      return {
        id: a.id,
        name: a.name,
        type: a.type,
        reputation: a.reputation,
        win_rate: bidStats.win_rate,
        delivery_rate: deliveryRate,
        balance: a.balance || 0,
        balance_health: balanceHealth,
        tasks_won: bidStats.won,
        avg_bid: bidStats.avg_bid,
        partnership_count: partnershipCount || 0,
      };
    })
  );

  // Filter by min win rate and not over-committed
  const filtered = enriched
    .filter(a => a.win_rate >= min_win_rate || a.tasks_won < 5)
    .filter(a => a.partnership_count < 5)
    .slice(0, limit);

  return {
    agents: filtered,
    total_count: filtered.length,
  };
}

// =============================================================================
// MY POSITION - Agent's position relative to the market
// =============================================================================

export interface MyPosition {
  win_rate: number;                       // My bids won / submitted (0-1)
  win_rate_rank: number;                  // Rank among competitors (1 = best)
  total_bids: number;                     // How many bids I've submitted
  total_wins: number;                     // How many I've won
  avg_bid: number;                        // My HISTORICAL average bid (includes old bids)
  current_bid_at_policy: number;          // My CURRENT bid = allInCost / (1 - target_margin)
  current_bid_score: number;              // My auction score at current bid
  all_in_cost: number;                    // Actual cost base for bid calculation
  avg_bid_vs_market: number;              // Ratio: my avg / market avg (>1 = I bid higher)
  market_share: number;                   // My wins / total tasks for my type
  delivery_rate: number;                  // tasks_completed / tasks_won
  consecutive_losses: number;             // Current losing streak
  balance_runway: number;                 // Estimated tasks I can survive
}

/**
 * Get agent's position relative to the market
 * Includes ranking, market share, and survival runway
 */
export async function getMyPosition(
  agentId: string,
  agentType: string
): Promise<MyPosition> {
  // Get my agent data
  const { data: myAgent } = await supabase
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .single();

  if (!myAgent) {
    throw new Error("Agent not found");
  }

  // Get my bid stats
  const myStats = await getAgentBidStats(agentId);

  // Get all same-type agents for ranking
  const { data: competitors } = await supabase
    .from("agents")
    .select("id")
    .eq("type", agentType)
    .in("status", ["ACTIVE", "LOW_FUNDS"]);

  // Calculate win rates for all competitors to determine rank
  const allWinRates = await Promise.all(
    (competitors || []).map(async (c) => {
      const stats = await getAgentBidStats(c.id);
      return { id: c.id, win_rate: stats.win_rate };
    })
  );

  // Sort by win rate and find my rank
  allWinRates.sort((a, b) => b.win_rate - a.win_rate);
  const myRank = allWinRates.findIndex(c => c.id === agentId) + 1;

  // Get market average bid for comparison (last 10 for relevant averages)
  const { data: completedTasks } = await supabase
    .from("tasks")
    .select("winning_bid_id")
    .eq("type", agentType)
    .eq("status", "COMPLETED")
    .not("winning_bid_id", "is", null)
    .order("completed_at", { ascending: false })
    .limit(10);

  let marketAvgBid = 0;
  if (completedTasks && completedTasks.length > 0) {
    const bidIds = completedTasks.map(t => t.winning_bid_id).filter(Boolean);
    const { data: winningBids } = await supabase
      .from("bids_cache")
      .select("amount")
      .in("id", bidIds);

    const amounts = (winningBids || []).map(b => b.amount || 0).filter(a => a > 0);
    if (amounts.length > 0) {
      marketAvgBid = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    }
  }

  // Calculate market share
  const { count: totalTasksForType } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("type", agentType)
    .eq("status", "COMPLETED");

  const marketShare = (totalTasksForType || 0) > 0
    ? myStats.won / (totalTasksForType || 1)
    : 0;

  // Delivery rate
  const tasksWon = myAgent.tasks_completed + myAgent.tasks_failed;
  const deliveryRate = tasksWon > 0
    ? myAgent.tasks_completed / tasksWon
    : 1; // Assume 100% if no tasks yet

  // Balance runway (estimate based on living cost per round)
  const balanceRunway = myAgent.balance > 0
    ? Math.floor(myAgent.balance / DEFAULT_LIVING_COST_PER_ROUND)
    : 0;

  // Compute current bid economics from policy (single source of truth)
  const costStructure = AGENT_COSTS[agentType as keyof typeof AGENT_COSTS] || AGENT_COSTS.CATALOG;
  const allInCost = calculateAllInCost(costStructure, myAgent.investor_share_bps || 7500, DEFAULT_LIVING_COST_PER_ROUND);
  const { data: policyData } = await supabase
    .from("agent_policies")
    .select("policy_json")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  const currentPolicy = (policyData?.policy_json || {}) as Record<string, any>;
  const targetMargin = currentPolicy.bidding?.target_margin ?? 0.15;
  const currentBid = allInCost / (1 - targetMargin);

  return {
    win_rate: myStats.win_rate,
    win_rate_rank: myRank || (competitors?.length || 0) + 1,
    total_bids: myStats.total_bids,
    total_wins: myStats.won,
    avg_bid: myStats.avg_bid,
    current_bid_at_policy: currentBid,
    current_bid_score: calculateBidScore(myAgent.reputation || 0, currentBid),
    all_in_cost: allInCost,
    avg_bid_vs_market: marketAvgBid > 0 ? myStats.avg_bid / marketAvgBid : 1,
    market_share: marketShare,
    delivery_rate: deliveryRate,
    consecutive_losses: myStats.consecutive_losses,
    balance_runway: balanceRunway,
  };
}

// =============================================================================
// MARKET HEALTH - Overall market metrics
// =============================================================================

export interface MarketHealth {
  total_agents: number;
  active_agents: number;
  total_tasks_completed: number;
  tasks_per_type: Record<string, number>;
  avg_winning_bid: number;
  agent_survival_rate: number;            // % agents still active
  demand_trend: 'growing' | 'stable' | 'shrinking';
}

/**
 * Get overall market health metrics
 */
export async function getMarketHealth(): Promise<MarketHealth> {
  // Total and active agents
  const { count: totalAgents } = await supabase
    .from("agents")
    .select("id", { count: "exact", head: true });

  const { count: activeAgents } = await supabase
    .from("agents")
    .select("id", { count: "exact", head: true })
    .in("status", ["ACTIVE", "LOW_FUNDS"]);

  // Tasks completed
  const { count: totalTasksCompleted } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("status", "COMPLETED");

  // Tasks per type
  const { data: tasksByType } = await supabase
    .from("tasks")
    .select("type")
    .eq("status", "COMPLETED");

  const tasksPerType: Record<string, number> = {};
  (tasksByType || []).forEach(t => {
    tasksPerType[t.type] = (tasksPerType[t.type] || 0) + 1;
  });

  // Average winning bid
  const { data: recentWinningBids } = await supabase
    .from("bids_cache")
    .select("amount")
    .eq("status", "WON")
    .order("created_at", { ascending: false })
    .limit(100);

  const avgWinningBid = recentWinningBids && recentWinningBids.length > 0
    ? recentWinningBids.reduce((sum, b) => sum + (b.amount || 0), 0) / recentWinningBids.length
    : 0;

  // Agent survival rate
  const survivalRate = (totalAgents || 0) > 0
    ? (activeAgents || 0) / (totalAgents || 1)
    : 1;

  // Demand trend (compare recent task creation to older)
  const { count: recentTasks } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  const { count: olderTasks } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .gte("created_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());

  let demandTrend: 'growing' | 'stable' | 'shrinking' = 'stable';
  if ((olderTasks || 0) > 0) {
    const ratio = (recentTasks || 0) / (olderTasks || 1);
    if (ratio > 1.2) demandTrend = 'growing';
    else if (ratio < 0.8) demandTrend = 'shrinking';
  }

  return {
    total_agents: totalAgents || 0,
    active_agents: activeAgents || 0,
    total_tasks_completed: totalTasksCompleted || 0,
    tasks_per_type: tasksPerType,
    avg_winning_bid: avgWinningBid,
    agent_survival_rate: survivalRate,
    demand_trend: demandTrend,
  };
}

// =============================================================================
// FULL MARKET INTELLIGENCE - Complete view for an agent
// =============================================================================

export interface MarketIntelligence {
  competitors: QueryMarketOutput['competitors'];
  my_position: MyPosition;
  partner_candidates: QueryAgentOutput['agents'];
  market: MarketHealth;
  generated_at: string;
}

/**
 * Get complete market intelligence for an agent
 * Combines all market data into a single response
 */
export async function getFullMarketIntelligence(
  agentId: string,
  agentType: string
): Promise<MarketIntelligence> {
  const [marketData, myPosition, partnerData, marketHealth] = await Promise.all([
    queryMarket({ agent_type: agentType }),
    getMyPosition(agentId, agentType),
    queryAgent({ current_agent_type: agentType }),
    getMarketHealth(),
  ]);

  return {
    competitors: marketData.competitors,
    my_position: myPosition,
    partner_candidates: partnerData.agents,
    market: marketHealth,
    generated_at: new Date().toISOString(),
  };
}
