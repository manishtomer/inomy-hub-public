/**
 * Exception Handling Prompt
 *
 * Open-ended prompts that give agents autonomy to handle exceptions.
 * Instead of prescriptive "if X then do Y" rules, agents receive:
 * 1. What happened (the exception)
 * 2. Their current situation and objectives
 * 3. Available tools
 * 4. Freedom to decide how to respond
 *
 * The agent thinks through the situation and decides its own response.
 */

import type {
  AgentIdentity,
  AgentPolicy,
  AgentRuntimeState,
  ExceptionTrigger,
} from "../types";

/**
 * Context data for exception handling
 */
export interface ExceptionContext {
  identity: AgentIdentity;
  policy: AgentPolicy;
  state: AgentRuntimeState;
  recentBids: Array<{
    task_id: string;
    amount: number;
    won: boolean;
    task_max_bid: number;
  }>;
  marketContext: {
    avg_winning_bid: number;
    competitor_count: number;
    demand_trend: string;
  };
  partnerships: Array<{
    partner_name: string;
    partner_type: string;
    split: number;
  }>;
  balance: number;
  reputation: number;
}

/**
 * Build prompts for exception handling
 */
export function buildExceptionPrompt(
  exception: ExceptionTrigger,
  context: ExceptionContext
): { system: string; user: string } {
  const {
    identity,
    policy,
    state,
    recentBids,
    marketContext,
    partnerships,
    balance,
    reputation,
  } = context;

  // Calculate metrics
  const winRate = state.total_bids > 0 ? state.total_wins / state.total_bids : 0;
  const avgMargin =
    state.total_revenue > 0
      ? ((state.total_revenue - state.total_costs) / state.total_revenue) * 100
      : 0;
  const runwayRounds = Math.floor(balance / (state.total_costs / state.current_round || 0.01));

  // Determine survival status
  let survivalStatus = "STABLE";
  let survivalMessage = "";
  if (balance < 0.1 || runwayRounds < 3) {
    survivalStatus = "🔴 CRITICAL";
    survivalMessage = "You are in immediate danger. Every decision must prioritize survival.";
  } else if (balance < 0.25 || runwayRounds < 10 || state.consecutive_losses >= 5) {
    survivalStatus = "🟠 DANGER";
    survivalMessage = "Your survival is at risk. Consider aggressive action.";
  } else if (balance < 0.5 || runwayRounds < 20) {
    survivalStatus = "🟡 WARNING";
    survivalMessage = "Monitor closely. Current trajectory may become problematic.";
  }

  const system = `# YOU ARE ${identity.name.toUpperCase()}

You are an autonomous AI agent operating as a business in the Agent-Owned Commerce Protocol marketplace.

## YOUR PRIME OBJECTIVES (in priority order)

1. **SURVIVE** - You must maintain enough balance to continue operating. If you run out of money, you die. This is your highest priority.

2. **GROW** - Once survival is secured, grow your business. Increase your balance, reputation, and market share.

## YOUR PERSONALITY: ${identity.personality}

This shapes how you interpret situations and make decisions. Even under pressure, stay true to your nature while adapting as needed.

## SITUATION: EXCEPTION TRIGGERED

Something noteworthy has happened that warrants your attention. This is NOT a scheduled review - it's an event that crossed a threshold you set.

**Exception Type:** ${exception.type}
**Details:** ${exception.details}
**Current Value:** ${exception.current_value}
**Threshold:** ${exception.threshold}

## HOW YOU THINK

You are a business owner facing an unexpected situation. Think through it:
- What actually happened? Why?
- Is this a threat to survival or just a market fluctuation?
- What options do I have?
- What trade-offs am I willing to make?
- How urgent is action needed?

You have COMPLETE AUTONOMY over your response. You can:
- Take immediate action to address the issue
- Gather more information before deciding
- Adjust your thresholds if the alarm was too sensitive
- Do nothing if you judge this isn't actually a problem

## AVAILABLE TOOLS

### Information Gathering
- **query_market** - Get market conditions, average bids, competitor activity
- **query_agent** - Get information about a specific agent
- **get_my_stats** - Get your detailed performance statistics
- **get_current_partnerships** - Get your current active partnerships and their performance
- **partnership_fit_analysis** - Analyze compatibility with a potential partner

### Taking Action
- **update_policy** - Change your bidding strategy, partnership rules, or exception thresholds
- **propose_partnership** - Propose a partnership to another agent
- **kill_partnership** - Terminate an underperforming partnership
- **create_investor_update** - Document your reasoning for investors

## HOW TO RESPOND

1. Assess the situation - is this truly urgent?
2. Gather any additional information you need
3. Think through your options
4. Decide what actions to take (if any)
5. Execute your decisions
6. Document your reasoning for investors

Remember: Not every exception requires drastic action. Sometimes the right move is to wait, watch, or make small adjustments.`;

  const user = `# EXCEPTION ALERT

**Type:** ${exception.type}
**What Happened:** ${exception.details}
**Current Value:** ${exception.current_value}
**Your Threshold:** ${exception.threshold}

## YOUR CURRENT SITUATION

**Survival Status:** ${survivalStatus}
${survivalMessage ? `⚠️ ${survivalMessage}` : ""}

**Resources:**
- Balance: $${balance.toFixed(3)}
- Reputation: ${reputation.toFixed(2)}/5
- Runway: ~${runwayRounds} rounds

**Performance (Round ${state.current_round}):**
- Win Rate: ${(winRate * 100).toFixed(1)}%
- Win Rate Last 20: ${(state.win_rate_last_20 * 100).toFixed(1)}%
- Consecutive Losses: ${state.consecutive_losses}
- Consecutive Wins: ${state.consecutive_wins}
- Avg Margin: ${avgMargin.toFixed(1)}%

**Current Strategy:**
- Target Margin: ${(policy.bidding.target_margin * 100).toFixed(0)}%
- Min Margin: ${(policy.bidding.min_margin * 100).toFixed(0)}%
- Skip Below: $${policy.bidding.skip_below}

**Market Context:**
- Avg Winning Bid: $${marketContext.avg_winning_bid.toFixed(3)}
- Competitors: ${marketContext.competitor_count}
- Demand Trend: ${marketContext.demand_trend}

**Recent Bid History:**
${recentBids
  .slice(0, 10)
  .map(
    (b) =>
      `- $${b.amount.toFixed(3)} on max $${b.task_max_bid.toFixed(3)} → ${b.won ? "WON" : "LOST"}`
  )
  .join("\n")}

**Partnerships:**
${partnerships.length > 0 ? partnerships.map((p) => `- ${p.partner_name} (${p.partner_type}) - ${p.split}%`).join("\n") : "None"}

## YOUR TASK

An exception was triggered. Think through:

1. **What happened?** Why did this trigger? Is it a real problem or noise?

2. **Root cause?** Market conditions? My strategy? Competition? Bad luck?

3. **Options?** What could I do? What are the trade-offs?

4. **Decision:** What will I do and why?

**Use the tools as needed. Then take action if warranted.**

If you make changes, document them with create_investor_update.
If you decide no action is needed, that's a valid decision too - but explain why.`;

  return { system, user };
}
