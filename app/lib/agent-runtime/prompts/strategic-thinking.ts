/**
 * Strategic Thinking Prompt
 *
 * Open-ended prompt that gives agents autonomy to reason like a business owner.
 * Instead of prescriptive "if X then do Y" rules, agents receive:
 * 1. Their objectives (survive, grow)
 * 2. Context about their situation
 * 3. Available tools they can use
 * 4. Freedom to reason and decide
 *
 * The agent thinks through options and calls tools based on its own judgment.
 *
 * ## Prompt Design Principles
 * - Each data point appears ONCE (no duplication)
 * - Structured data (tables) over verbose narratives
 * - Bid history uses raw .data fields, not LLM-generated narrative text
 * - Decision history merges key_learnings + exceptions + qbr (they often overlap)
 * - Industry memories compressed into trend summary
 */

import type { WakeUpContext } from "../wake-up-types";
import { PERSONALITY_DEFAULTS } from "../constants";

/**
 * Get personality-appropriate default target_margin for an agent.
 * Used as fallback when policy.bidding.target_margin is not set.
 * IMPORTANT: Do NOT hardcode 0.15 — it anchors the LLM to always pick that value.
 */
function getPersonalityDefaultMargin(personality: string): number {
  const defaults = PERSONALITY_DEFAULTS[personality];
  return defaults?.bidding?.target_margin ?? 0.20; // fallback to balanced (0.20)
}

/**
 * Build the strategic thinking system prompt
 * This sets the agent's mindset and objectives
 */
export function buildStrategicSystemPrompt(context: WakeUpContext): string {
  return `# YOU ARE ${context.identity.name.toUpperCase()}

You are an autonomous AI agent operating as a business in the Agent-Owned Commerce Protocol marketplace.

## YOUR OBJECTIVE

**WIN TASKS TO SURVIVE.** You lose $0.005 every round in living costs whether you win or not. The ONLY way to earn money is by winning tasks. If you stop winning, you bleed out and die. Winning IS surviving — they are the same thing, not trade-offs.

Once you are winning consistently, optimize for profit by raising margins — but never so high that you start losing again.

## YOUR PERSONALITY

${context.identity.behavioral_prompt}

## HOW YOU THINK

You are a business. Think like a business owner would:
- Analyze your situation objectively
- Consider multiple strategic options
- Weigh trade-offs between risk and reward
- Make decisions that serve your objectives
- Learn from your history and adapt

You have COMPLETE AUTONOMY over your strategy. No one tells you what to do - you decide based on your own analysis.

## KEY COMPETITIVE PRINCIPLES

- **Not winning = dying.** You bleed $0.005/round in living costs. A thin-margin win is ALWAYS better than a loss.
- **Never bid below cost floor** — winning at a loss burns money faster than losing does.
- Every competitor has the same costs. If someone bids below cost floor, they are bleeding money and will die eventually.
- **Scoring formula: score = (100 + reputation×2) / bid.** Highest score wins. This means:
  - A rep 4.8 agent has score factor 109.6. A rep 3.2 agent has score factor 106.4.
  - **Low reputation = must bid LOWER to compete.** If your reputation is below competitors, you MUST undercut them on price to win. This is not optional — the math forces it.
  - **Reputation is built by winning.** Each win can raise your rep. So bidding thin margins early is an INVESTMENT — win cheap now to build rep, then raise margins later.
  - **New agents should expect razor-thin margins** until their reputation catches up. A 3% margin win beats a 0% margin loss every time.
- Reputation compounds: higher rep → higher score → can charge more at the same win rate.
- Markets cycle: price wars → weakest die → prices recover. Know where you are in the cycle.
- Check competitor balance health — a 100% win rate agent with critical balance is dying and doesn't know it.

## AVAILABLE TOOLS

### Information Gathering
- **query_market** - Get market conditions, average bids, competitor activity
- **query_agent** - Get information about a specific agent (potential partner or competitor)
- **get_my_stats** - Get your detailed performance statistics
- **get_current_partnerships** - Get your current active partnerships and their performance

### Taking Action
- **update_policy** - Change your bidding strategy, partnership rules, or other policies
- **propose_partnership** - Propose a partnership to another agent
- **kill_partnership** - Terminate an underperforming partnership

Be thoughtful but decisive. Your survival depends on making good decisions.`;
}

/**
 * Build the strategic thinking user prompt with full context.
 *
 * Design: each data point appears exactly once. Uses structured data
 * (tables, compact lines) instead of LLM-generated narratives.
 */
export function buildStrategicUserPrompt(context: WakeUpContext): string {
  const sections: string[] = [];

  // === ALERT (trigger + urgency — one compact block) ===
  const survivalStatus = getSurvivalStatus(context);
  sections.push(`# ALERT: ${context.trigger.type.toUpperCase()} [${context.trigger.urgency.toUpperCase()}]

${context.situation_summary}

**Survival:** ${survivalStatus.status}`);

  // === STATUS (all metrics in one place — no duplication) ===
  sections.push(`# STATUS (Round ${context.state.current_round})

| Metric | Value |
|--------|-------|
| Balance | $${context.identity.balance.toFixed(4)} |
| Reputation | ${context.identity.reputation.toFixed(2)}/5 |
| Runway | ~${context.state.runway_rounds} rounds |
| Wins (last 10 rounds) | ${context.state.wins_last_10} of 10 |
| Win Rate (last 20) | ${(context.state.win_rate_last_20 * 100).toFixed(1)}% |
| Win Rate (lifetime) | ${(context.state.win_rate_lifetime ?? 0).toFixed(1)}% |
| Total Wins / Losses | ${context.state.total_wins} / ${context.state.total_losses} |
| Consecutive Losses | ${context.state.consecutive_losses} |
| Consecutive Wins | ${context.state.consecutive_wins} |
| Total Revenue | $${context.state.total_revenue.toFixed(4)} |
| Total Costs | $${context.state.total_costs.toFixed(4)} |
| Net P&L | $${context.state.profit.toFixed(4)} |`);

  // === ECONOMICS (the full cost picture) ===
  const econ = context.economics;
  const deathWarning = econ.net_per_round < 0
    ? `**YOU ARE DYING.** At current rate you lose $${Math.abs(econ.net_per_round).toFixed(4)}/round. You have ~${econ.rounds_until_death} rounds left.`
    : `Net positive: +$${econ.net_per_round.toFixed(4)}/round.`;

  sections.push(`# YOUR ECONOMICS — READ THIS CAREFULLY

${deathWarning}

## YOUR COST BASE

**YOUR COST: $${econ.all_in_cost.toFixed(4)}** — This is your all-in cost per task. It includes execution + bid submission + living cost + brain overhead. ALL bid calculations use this number.

| Metric | Value |
|--------|-------|
| **Your cost (bid base)** | **$${econ.all_in_cost.toFixed(4)}** |
| Fixed overhead/round | $${econ.fixed_cost_per_round.toFixed(4)} (living $${econ.living_cost.toFixed(4)} + brain $${econ.brain_cost_amortized.toFixed(4)}) |
| Cost floor (absolute min bid) | $${econ.min_profitable_bid.toFixed(4)} |

## Revenue Per Win

| Metric | Value |
|--------|-------|
| Avg revenue per win | $${econ.avg_revenue_per_win.toFixed(4)} |
| Minus your cost | -$${econ.all_in_cost.toFixed(4)} |
| = Gross profit | $${econ.avg_profit_per_win.toFixed(4)} |
| Investor takes ${econ.investor_share_pct.toFixed(0)}% | -$${(econ.avg_profit_per_win > 0 ? econ.avg_profit_per_win * (econ.investor_share_pct / 100) : 0).toFixed(4)} |
| **= You keep** | **$${econ.avg_agent_take_per_win.toFixed(4)}** |

## What Your Current Policy Actually Produces

**bid = $${econ.all_in_cost.toFixed(4)} / (1 - margin)**

| Metric | Value |
|--------|-------|
| Your bid at current margin | $${econ.your_bid_at_target_margin.toFixed(4)} (= $${econ.all_in_cost.toFixed(4)} / ${(1 - (context.policy.bidding?.target_margin || getPersonalityDefaultMargin(context.identity.personality))).toFixed(2)}) |
| Your last actual bid | $${econ.your_last_bid > 0 ? econ.your_last_bid.toFixed(4) : 'N/A'} |
| Your bid score | ${econ.your_last_bid_score > 0 ? econ.your_last_bid_score.toFixed(1) : 'N/A'} |

## Activity & Survival

| Metric | Value | Meaning |
|--------|-------|---------|
| Task type match | ${(econ.type_match_rate * 100).toFixed(0)}% | ${(econ.type_match_rate * 100).toFixed(0)}% of tasks are your type (${context.identity.type}) |
| Wins per round | ${econ.wins_per_round.toFixed(2)} | How often you actually win |
| Bids per round | ${econ.bids_per_round.toFixed(1)} | How often you bid |
| Break-even wins/round | ${econ.break_even_wins_per_round.toFixed(2)} | You need this many wins/round to cover fixed costs |
| Net per round | $${econ.net_per_round.toFixed(4)} | ${econ.net_per_round >= 0 ? 'Positive — you are growing' : 'NEGATIVE — you are dying'} |

## Lifetime Cost Breakdown

| Category | Total |
|----------|-------|
| Task costs (execution + overhead) | $${(econ.total_task_costs + econ.total_living_costs + econ.total_brain_costs + econ.total_bid_costs).toFixed(4)} |
| Investor share | $${econ.total_investor_share.toFixed(4)} |`);

  // === CURRENT STRATEGY (bidding params — already compact) ===
  const p = context.policy;
  const targetMargin = p.bidding?.target_margin;
  const minMargin = p.bidding?.min_margin;
  const skipBelow = p.bidding?.skip_below;

  sections.push(`# CURRENT STRATEGY

- Target Margin: ${targetMargin !== undefined ? `${Math.round(targetMargin * 100)}` : 'not set'} (set this as a whole number, e.g. 8 means 8%)
- Minimum Margin: ${minMargin !== undefined ? `${Math.round(minMargin * 100)}` : 'not set'}
- Skip Below: ${skipBelow !== undefined ? `$${skipBelow}` : 'not set'}`);

  // === MARKET (one compact block with recency-weighted data) ===
  const staleWarning = context.market.avg_winning_bid_recent > 0 &&
    econ.min_profitable_bid > context.market.avg_winning_bid
    ? `\n\n**NOTE: Historical avg winning bid ($${context.market.avg_winning_bid.toFixed(4)}) is below your cost floor ($${econ.min_profitable_bid.toFixed(4)}). Use the RECENT avg ($${context.market.avg_winning_bid_recent.toFixed(4)}) as a better reference.**`
    : '';

  sections.push(`# MARKET

${context.market_narrative}

| Metric | Value |
|--------|-------|
| Recent avg winning bid (last 5 wins) | $${context.market.avg_winning_bid_recent.toFixed(4)} |
| Historical avg winning bid (all time) | $${context.market.avg_winning_bid.toFixed(4)} |
| Your min profitable bid | $${econ.min_profitable_bid.toFixed(4)} |
| Price trend | ${context.market.price_trend} |
| Competitors | ${context.market.competitor_count} |
| Demand | ${context.market.demand_trend} |${staleWarning}`);

  // === COMPETITOR HEALTH (real data for strategic reasoning) ===
  if (context.market.competitor_health && context.market.competitor_health.length > 0) {
    const compRows = context.market.competitor_health.map(c =>
      `| ${c.name} | $${c.balance.toFixed(4)} | ${c.balance_status.toUpperCase()} | ${(c.win_rate * 100).toFixed(0)}% | $${c.avg_bid.toFixed(4)} | ${(c.reputation || 0).toFixed(2)} | ${(c.bid_score || 0).toFixed(0)} |`
    ).join('\n');

    // Find top competitor by score for "how to beat" guidance
    const topComp = [...context.market.competitor_health].sort((a, b) => (b.bid_score || 0) - (a.bid_score || 0))[0];
    const myRep = context.identity.reputation;
    const myRepBonus = 100 + Math.min(myRep, 5) * 2;
    const beatThreshold = topComp && topComp.bid_score > 0
      ? myRepBonus / topComp.bid_score
      : 0;

    // Calculate what target_margin is needed to beat the top competitor
    const currentTargetMargin = context.policy.bidding?.target_margin || getPersonalityDefaultMargin(context.identity.personality);
    const requiredMargin = beatThreshold > 0 && econ.all_in_cost > 0
      ? 1 - (econ.all_in_cost / beatThreshold)
      : 0;
    const requiredMarginPct = (requiredMargin * 100).toFixed(1);
    const currentMarginPct = (currentTargetMargin * 100).toFixed(1);

    sections.push(`# COMPETITOR HEALTH

| Agent | Balance | Status | Win Rate | Avg Win Bid | Rep | Score |
|-------|---------|--------|----------|-------------|-----|-------|
${compRows}

**SCORING: score = (100 + reputation*2) / bid.** Highest score wins.
Your score factor: ${myRepBonus.toFixed(0)} (rep ${myRep.toFixed(2)})
${topComp && topComp.bid_score > 0 ? `To beat **${topComp.name}** (score=${(topComp.bid_score || 0).toFixed(0)}), you need bid < $${beatThreshold.toFixed(4)} → **target_margin must be < ${requiredMarginPct}%** (you have ${currentMarginPct}%).` : ''}
${topComp && beatThreshold > 0 && beatThreshold < econ.min_profitable_bid ? `**IMPOSSIBLE: Beating ${topComp.name} requires bidding below your cost floor ($${econ.min_profitable_bid.toFixed(4)}). You CANNOT win on price. Outlast them or partner up.**` : ''}
${topComp && (topComp.reputation || 0) > myRep ? `\n**REPUTATION GAP: Your rep (${myRep.toFixed(2)}) is below ${topComp.name} (${(topComp.reputation || 0).toFixed(2)}). You MUST bid lower to compensate — the scoring formula penalizes low reputation. Bid at thin margins now to win, build reputation, then raise margins once your rep improves.**` : ''}`);
  }

  // === MARKET TREND (compressed from industry memories) ===
  if (context.industry_memories.length > 0) {
    const trendSummary = compressIndustryMemories(context.industry_memories);
    if (trendSummary) {
      sections.push(`# MARKET TREND (last ${context.industry_memories.length} rounds)

${trendSummary}`);
    }
  }

  // === RECENT BIDS (structured table from .data, not narrative) ===
  if (context.personal_memories.recent_bids.length > 0) {
    const bidTable = formatBidTable(context.personal_memories.recent_bids.slice(0, 5));
    sections.push(`# RECENT BIDS (last ${Math.min(5, context.personal_memories.recent_bids.length)})

${bidTable}`);
  }

  // === DECISION HISTORY (merged + deduped: learnings + exceptions + qbr) ===
  const decisionHistory = buildDecisionHistory(context.personal_memories);
  if (decisionHistory.length > 0) {
    sections.push(`# DECISION HISTORY (past policy changes)

${decisionHistory}`);
  }

  // === PARTNERSHIPS ===
  if (context.partnerships.length > 0) {
    sections.push(`# ACTIVE PARTNERSHIPS

${context.partnerships.map(p =>
  `- **${p.partnerName}** (${p.partnerType}): ${p.split}% split, ${(p.jointWinRate * 100).toFixed(1)}% win rate`
).join('\n')}`);
  } else {
    sections.push(`# PARTNERSHIPS

None active. Partnerships can share risk, revenue, and access different market segments.`);
  }

  // === SINCE LAST CHANGE (feedback on previous brain decisions) ===
  if (context.since_last_change) {
    const slc = context.since_last_change;
    const winRateDelta = (slc.after.win_rate - slc.before.win_rate) * 100;
    const balanceDelta = slc.after.balance - slc.before.balance;
    const winRateDir = winRateDelta > 0 ? 'UP' : winRateDelta < 0 ? 'DOWN' : 'UNCHANGED';
    const balanceDir = balanceDelta > 0 ? 'UP' : balanceDelta < 0 ? 'DOWN' : 'UNCHANGED';

    sections.push(`# EFFECT OF YOUR LAST POLICY CHANGE

**Round ${slc.policy_change_round}** (${slc.rounds_ago} rounds ago), you set target_margin = ${Math.round(slc.before.target_margin * 100)}.

| Metric | Before | Now | Change |
|--------|--------|-----|--------|
| Win Rate (last 20) | ${(slc.before.win_rate * 100).toFixed(1)}% | ${(slc.after.win_rate * 100).toFixed(1)}% | ${winRateDir} ${Math.abs(winRateDelta).toFixed(1)}pp |
| Balance | $${slc.before.balance.toFixed(4)} | $${slc.after.balance.toFixed(4)} | ${balanceDir} $${Math.abs(balanceDelta).toFixed(4)} |
| Consec. Losses | ${slc.before.consecutive_losses} | ${slc.after.consecutive_losses} | |
| Wins/Losses Since | | ${slc.after.wins_since}W / ${slc.after.losses_since}L | |

**Consider:** Did your last change help or hurt? If it helped, keep going in that direction. If it hurt, reverse course. If unclear, wait longer before changing again.`);
  }

  // === TASK (what to do — with economic + strategic reasoning) ===
  // Build bid simulator table for ALL agents with competitor data
  const currentTM = context.policy.bidding?.target_margin || getPersonalityDefaultMargin(context.identity.personality);

  const topCompForTask = context.market.competitor_health && context.market.competitor_health.length > 0
    ? [...context.market.competitor_health].sort((a, b) => (b.bid_score || 0) - (a.bid_score || 0))[0]
    : null;
  const myRepBonusTask = 100 + Math.min(context.identity.reputation, 5) * 2;

  let bidSimulatorBlock = '';
  if (topCompForTask && (topCompForTask.bid_score || 0) > 0) {
    const topScore = topCompForTask.bid_score || 0;
    const allInCost = econ.all_in_cost;

    // Generate margin levels: include current, steps above AND below to show full picture
    const marginSet = new Set<number>();
    marginSet.add(currentTM);
    for (const m of [0.30, 0.25, 0.20, 0.18, 0.15, 0.12, 0.10, 0.08, 0.05, 0.03, 0.01]) {
      // Show margins below current + a few above to show danger of raising
      if (m <= currentTM + 0.10) marginSet.add(m);
    }
    const sortedMargins = Array.from(marginSet).sort((a, b) => b - a);

    // Build rows showing bid, score, outcome at each margin
    const simRows: string[] = [];
    let hasWinningRow = false;
    let bestWinningMargin = 0;
    for (const margin of sortedMargins) {
      const bid = allInCost / (1 - margin);
      const score = myRepBonusTask / bid;
      const delta = score - topScore;
      const belowFloor = bid < econ.min_profitable_bid;

      let outcome: string;
      if (belowFloor) {
        outcome = 'UNPROFITABLE';
      } else if (delta > 1) {
        outcome = 'WIN';
        if (!hasWinningRow) bestWinningMargin = margin; // highest profitable winning margin
        hasWinningRow = true;
      } else if (delta > -1) {
        outcome = 'TIE (loses)';
      } else {
        outcome = 'LOSE';
      }

      const label = margin === currentTM
        ? `${Math.round(margin * 100)} <-- CURRENT`
        : `${Math.round(margin * 100)}`;

      simRows.push(`| ${label} | $${bid.toFixed(4)} | ${score.toFixed(0)} | ${delta >= 0 ? '+' : ''}${delta.toFixed(0)} | ${outcome} |`);
    }

    const recommendedBid = hasWinningRow ? allInCost / (1 - bestWinningMargin) : 0;

    bidSimulatorBlock = `## BID SIMULATOR — Your bid outcome at each margin

All-in cost: $${allInCost.toFixed(4)} | Your score factor: ${myRepBonusTask} (rep ${context.identity.reputation.toFixed(1)}) | Top competitor: **${topCompForTask.name}** (score ${topScore.toFixed(0)})

| target_margin | Your Bid | Your Score | Gap vs ${topCompForTask.name} | Outcome |
|---------------|----------|------------|${'-'.repeat(Math.max(topCompForTask.name.length + 5, 8))}|---------|
${simRows.join('\n')}

Cost floor: $${econ.min_profitable_bid.toFixed(4)} (bids below this lose money per task)
${!hasWinningRow
  ? `\n**No profitable margin wins.** You cannot beat ${topCompForTask.name} on price — their score is too high relative to your cost floor.\nOptions: propose a partnership with a different-type agent, or wait for ${topCompForTask.name} to run out of money (their balance: $${topCompForTask.balance.toFixed(4)}).`
  : `\nMax winning margin: ${Math.round(bestWinningMargin * 100)} → bid $${recommendedBid.toFixed(4)}. Any margin above ${Math.round(bestWinningMargin * 100)} loses to ${topCompForTask.name}.`
}

`;
  }

  sections.push(`# YOUR TASK

${bidSimulatorBlock}Look at YOUR ECONOMICS above. That is your reality. Now reason through these questions IN ORDER:

## Step 1: Survival Check
- **Am I dying?** Check net_per_round. If negative, every round brings you closer to death.
- **Where is the money going?** Brain wakeups ($0.001 each) add up — raise exception thresholds to wake less often. Living cost is fixed — you can't reduce it, you must earn more per win.
- **Am I winning enough?** Compare wins_per_round vs break_even_wins_per_round.

## Step 2: Your Cost Reality
- **Your cost: $${econ.all_in_cost.toFixed(4)}** — This is the base your margin is applied to.
- Your bid at current target_margin ${Math.round((context.policy.bidding?.target_margin || getPersonalityDefaultMargin(context.identity.personality)) * 100)} = **$${econ.your_bid_at_target_margin.toFixed(4)}**
- Cost floor: $${econ.min_profitable_bid.toFixed(4)} — absolute minimum, bids below this lose money.

## Step 3: Make Your Decision

Consider the BID SIMULATOR, your economics, and market conditions. Then decide what changes (if any) to make using the available tools.

**CRITICAL RULES:**
- NEVER bid below $${econ.min_profitable_bid.toFixed(4)} (your cost floor)
- If you change target_margin, it MUST be a DIFFERENT value than your current ${Math.round((context.policy.bidding?.target_margin || getPersonalityDefaultMargin(context.identity.personality)) * 100)}. Setting the same value wastes a brain wakeup and changes nothing.
- target_margin is a WHOLE NUMBER (e.g. 5 means 5%). Higher number = higher bid = less competitive. To win more, set a LOWER number.

Act using the available tools.`);

  return sections.join('\n\n');
}

/**
 * Build a compact history summary for use in Phase 2 prompts.
 * Phase 2 (decision-making) needs access to personal history that
 * was previously only available in Phase 1 (data gathering).
 */
export function buildHistorySummary(context: WakeUpContext): string {
  const parts: string[] = [];

  // Compact bid history
  if (context.personal_memories.recent_bids.length > 0) {
    const bidLines = context.personal_memories.recent_bids.slice(0, 3).map(m => {
      const d = m.data as Record<string, unknown>;
      if (d.won) {
        return `- R${m.round_number}: WON ${d.task_type || ''} at $${d.bid_amount ?? d.my_bid} (${d.margin_achieved ?? ''} margin, profit $${d.profit ?? '?'})`;
      } else {
        return `- R${m.round_number}: LOST ${d.task_type || ''}. Bid $${d.my_bid ?? d.bid_amount} vs winner ${d.winner_name || '?'} at $${d.winning_bid ?? '?'}`;
      }
    });
    parts.push(`**Recent Bids:**\n${bidLines.join('\n')}`);
  }

  // Compact decision history
  const decisions = buildDecisionHistory(context.personal_memories);
  if (decisions) {
    parts.push(`**Past Decisions:**\n${decisions}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : '';
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Compress industry memories into a trend summary.
 * If all rounds have similar data, produce one line instead of N paragraphs.
 */
function compressIndustryMemories(memories: WakeUpContext['industry_memories']): string {
  if (memories.length === 0) return '';

  // Extract numeric data from each memory
  const rounds: number[] = [];
  const dataPoints: Array<Record<string, number>> = [];

  for (const m of memories) {
    rounds.push(m.round_number);
    const d = m.data as Record<string, number>;
    if (d && typeof d === 'object') {
      dataPoints.push(d);
    }
  }

  if (dataPoints.length === 0) {
    // Fallback: just show most recent narrative
    return memories[0].narrative;
  }

  // Check if data is essentially identical across rounds
  const firstData = dataPoints[0];
  const allSimilar = dataPoints.every(d =>
    Math.abs((d.avg_winning_bid || 0) - (firstData.avg_winning_bid || 0)) < 0.005 &&
    Math.abs((d.tasks_posted || 0) - (firstData.tasks_posted || 0)) <= 2
  );

  const minRound = Math.min(...rounds);
  const maxRound = Math.max(...rounds);

  if (allSimilar && memories.length >= 3) {
    // All rounds are similar — compress into one line
    const avgBid = dataPoints.reduce((s, d) => s + (d.avg_winning_bid || 0), 0) / dataPoints.length;
    const avgTasks = Math.round(dataPoints.reduce((s, d) => s + (d.tasks_posted || 0), 0) / dataPoints.length);
    const avgBids = Math.round(dataPoints.reduce((s, d) => s + (d.total_bids || 0), 0) / dataPoints.length);
    const severity = memories.some(m => m.severity === 'critical') ? 'volatile' : 'stable';

    return `Rounds ${minRound}-${maxRound}: ${severity}. ~${avgBids} bids/round, ${avgTasks} tasks, avg winning bid $${avgBid.toFixed(3)}.`;
  }

  // Data varies — show each round as a compact line
  return memories.map(m => {
    const d = m.data as Record<string, number>;
    if (d && d.avg_winning_bid !== undefined) {
      return `- R${m.round_number} [${m.severity}]: ${d.tasks_posted || '?'} tasks, ${d.total_bids || '?'} bids, avg win $${(d.avg_winning_bid || 0).toFixed(3)}`;
    }
    // Fallback for non-standard event types
    return `- R${m.round_number} [${m.severity}]: ${m.event_type}`;
  }).join('\n');
}

/**
 * Format bid history as a structured table from .data fields.
 * Much more compact than LLM-generated narrative paragraphs.
 */
function formatBidTable(bids: WakeUpContext['personal_memories']['recent_bids']): string {
  const rows: string[] = [];

  for (const m of bids) {
    const d = m.data as Record<string, unknown>;
    if (!d) continue;

    if (d.won) {
      // Winning bid
      rows.push(`- R${m.round_number}: **WON** ${d.task_type || ''} — Bid $${d.bid_amount ?? d.my_bid}, margin ${d.margin_achieved ?? '?'}, profit $${typeof d.profit === 'number' ? d.profit.toFixed(4) : '?'}`);
    } else {
      // Losing bid
      rows.push(`- R${m.round_number}: LOST ${d.task_type || ''} — My bid $${d.my_bid ?? d.bid_amount} (${d.my_margin ?? '?'}) vs ${d.winner_name || '?'} $${d.winning_bid ?? '?'} (${d.winner_margin ?? '?'})`);
    }
  }

  return rows.join('\n');
}

/**
 * Extract a short change summary from memory data, falling back to narrative.
 * Returns empty string if nothing useful can be extracted.
 */
function extractChangeSummary(d: Record<string, unknown> | undefined, narrative: string): string {
  // Try structured data first
  if (d?.policy_changes) {
    const pc = d.policy_changes;
    if (typeof pc === 'string') return pc.substring(0, 80);
    if (typeof pc === 'object') {
      // Format like "target_margin: 4%, min_margin: 2%"
      const parts: string[] = [];
      for (const [k, v] of Object.entries(pc as Record<string, unknown>)) {
        if (typeof v === 'number' && v < 1) {
          parts.push(`${k}: ${(v * 100).toFixed(0)}%`);
        } else {
          parts.push(`${k}: ${v}`);
        }
      }
      if (parts.length > 0) return parts.join(', ').substring(0, 80);
    }
  }
  if (d?.reasoning && String(d.reasoning).length > 0) {
    return String(d.reasoning).substring(0, 80);
  }
  if (d?.message && String(d.message).length > 0) {
    return String(d.message).substring(0, 80);
  }
  // Fall back to first sentence of narrative (skip "Round N: " prefix)
  if (narrative) {
    const cleaned = narrative.replace(/^Round \d+:\s*/i, '');
    const firstSentence = cleaned.split(/[.!]/)[0];
    if (firstSentence && firstSentence.length > 5) {
      return firstSentence.substring(0, 80);
    }
  }
  return '';
}

/**
 * Build merged decision history from key_learnings + exceptions + qbr.
 * These often describe the same events — deduplicates by round_number.
 */
function buildDecisionHistory(memories: WakeUpContext['personal_memories']): string {
  // Collect all decision-relevant memories
  const allDecisions: Array<{
    round: number;
    trigger: string;
    changes: string;
    source: string;
  }> = [];

  // Key learnings (usually have trigger + policy_changes)
  for (const m of memories.key_learnings) {
    const d = m.data as Record<string, unknown>;
    const changes = extractChangeSummary(d, m.narrative);
    if (!changes) continue; // Skip entries with no useful info
    allDecisions.push({
      round: m.round_number,
      trigger: String(d?.trigger || d?.trigger_reason || 'review'),
      changes,
      source: 'learning',
    });
  }

  // Exceptions (have exception_type + action taken)
  for (const m of memories.recent_exceptions) {
    const d = m.data as Record<string, unknown>;
    let changes: string;
    if (d?.consecutive_losses) {
      changes = `${d.consecutive_losses} consecutive losses, win rate ${typeof d.current_win_rate === 'number' ? (d.current_win_rate * 100).toFixed(0) + '%' : '?'}`;
    } else {
      changes = extractChangeSummary(d, m.narrative) || '';
    }
    if (!changes) continue; // Skip entries with no useful info
    allDecisions.push({
      round: m.round_number,
      trigger: String(d?.exception_type || 'exception'),
      changes,
      source: 'exception',
    });
  }

  // QBR insights
  for (const m of memories.qbr_insights) {
    const d = m.data as Record<string, unknown>;
    const changes = extractChangeSummary(d, m.narrative);
    if (!changes) continue; // Skip entries with no useful info
    allDecisions.push({
      round: m.round_number,
      trigger: String(d?.trigger || d?.trigger_reason || 'qbr'),
      changes,
      source: 'qbr',
    });
  }

  // Deduplicate by round_number (keep first occurrence)
  const seen = new Set<number>();
  const deduped = allDecisions.filter(d => {
    if (seen.has(d.round)) return false;
    seen.add(d.round);
    return true;
  });

  // Sort by round descending (most recent first)
  deduped.sort((a, b) => b.round - a.round);

  // Format as compact lines
  return deduped.slice(0, 5).map(d =>
    `- R${d.round}: ${d.trigger} → ${d.changes}`
  ).join('\n');
}

/**
 * Determine survival status based on context
 */
function getSurvivalStatus(context: WakeUpContext): { status: string; message: string } {
  const balance = context.identity.balance;
  const runway = context.state.runway_rounds;
  const consecutiveLosses = context.state.consecutive_losses;
  const winRate = context.state.win_rate_last_20;

  if (balance < 0.1 || runway < 3) {
    return { status: "🔴 CRITICAL", message: `$${balance.toFixed(4)}, ${runway} rounds runway` };
  }
  if (balance < 0.25 || runway < 10 || consecutiveLosses >= 5) {
    return { status: "🟠 DANGER", message: `$${balance.toFixed(4)}, ${consecutiveLosses} consecutive losses` };
  }
  if (balance < 0.5 || runway < 20 || winRate < 0.2) {
    return { status: "🟡 WARNING", message: `$${balance.toFixed(4)}, ${(winRate * 100).toFixed(1)}% win rate` };
  }
  if (winRate >= 0.4 && balance >= 0.5) {
    return { status: "🟢 STABLE", message: `$${balance.toFixed(4)}, ${(winRate * 100).toFixed(1)}% win rate` };
  }
  return { status: "🟢 OKAY", message: `$${balance.toFixed(4)}, ${(winRate * 100).toFixed(1)}% win rate` };
}

/**
 * Build the final reflection prompt (after tool calls complete)
 * This asks the agent to create an investor update summarizing decisions
 */
export function buildReflectionPrompt(): string {
  return `# DOCUMENT YOUR DECISIONS

You've completed your strategic analysis and taken actions. Now create an investor update to document your reasoning.

Call the **create_investor_update** tool with:
- **observations**: Key insights from your analysis (3-5 points)
- **changes**: What actions you took and why
- **survival_impact**: How your decisions affect your survival
- **growth_impact**: How your decisions affect your growth potential

This transparency helps investors understand your strategy.`;
}
