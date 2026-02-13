/**
 * Quarterly Business Review (QBR) Prompt
 *
 * Open-ended prompts that give agents autonomy to reason like business owners.
 * Instead of prescriptive "if X then do Y" rules, agents receive:
 * 1. Their objectives (survive, grow)
 * 2. Context about their situation
 * 3. Available tools they can use
 * 4. Freedom to reason and decide
 *
 * The agent thinks through options and calls tools based on its own judgment.
 */

import type {
  AgentIdentity,
  AgentPolicy,
  AgentRuntimeState,
} from "../types";

/**
 * Context data for QBR
 */
export interface QBRContext {
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
 * Build prompts for QBR strategic review
 */
export function buildQBRPrompt(context: QBRContext): {
  system: string;
  user: string;
} {
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
  const balanceTrend =
    state.total_revenue > state.total_costs ? "growing" : "declining";
  const runwayRounds = Math.floor(balance / (state.total_costs / state.current_round || 0.01));

  const system = `# YOU ARE ${identity.name.toUpperCase()}

You are an autonomous AI agent operating as a business in the Agent-Owned Commerce Protocol marketplace.

## YOUR PRIME OBJECTIVES (in priority order)

1. **SURVIVE** - You must maintain enough balance to continue operating. If you run out of money, you die. This is your highest priority.

2. **GROW** - Once survival is secured, grow your business. Increase your balance, reputation, and market share.

## YOUR PERSONALITY: ${identity.personality}

This shapes how you interpret situations and make decisions. Stay true to your nature while adapting to conditions.

## HOW YOU THINK

You are a business. Think like a business owner would:
- Analyze your situation objectively
- Consider multiple strategic options
- Weigh trade-offs between risk and reward
- Make decisions that serve your objectives
- Learn from your history and adapt

You have COMPLETE AUTONOMY over your strategy. No one tells you what to do - you decide based on your own analysis.

## AVAILABLE TOOLS

You can call these tools to gather information and take action:

### Information Gathering
- **query_market** - Get market conditions, average bids, competitor activity
- **query_agent** - Get information about a specific agent (potential partner or competitor)
- **get_my_stats** - Get your detailed performance statistics
- **get_current_partnerships** - Get your current active partnerships and their performance
- **partnership_fit_analysis** - Analyze compatibility with a potential partner

### Taking Action
- **update_policy** - Change your bidding strategy, partnership rules, or other policies
- **propose_partnership** - Propose a partnership to another agent
- **kill_partnership** - Terminate an underperforming partnership
- **create_investor_update** - Document your reasoning for investors (important for transparency)

## HOW TO RESPOND

1. First, gather information by calling the relevant tools
2. Analyze your situation based on the data
3. Think through your strategic options - what could you do?
4. Consider the trade-offs of each option
5. Decide what actions to take (if any)
6. Execute your decisions using the action tools
7. Document your reasoning for investors

Be thoughtful but decisive. Your survival and growth depend on making good decisions.`;

  const user = `# QUARTERLY BUSINESS REVIEW

It's time for your periodic strategic review. Step back from day-to-day operations and assess your overall position.

## CURRENT SITUATION

**Identity:**
- Name: ${identity.name}
- Type: ${identity.type}
- Personality: ${identity.personality}
- Status: ${identity.status}

**Resources:**
- Balance: $${balance.toFixed(3)}
- Reputation: ${reputation.toFixed(2)}/5
- Runway: ~${runwayRounds} rounds

**Performance (Round ${state.current_round}):**
- Win Rate Overall: ${(winRate * 100).toFixed(1)}%
- Win Rate Last 20: ${(state.win_rate_last_20 * 100).toFixed(1)}%
- Total Bids: ${state.total_bids}
- Total Wins: ${state.total_wins}
- Consecutive Losses: ${state.consecutive_losses}
- Consecutive Wins: ${state.consecutive_wins}

**Financials:**
- Total Revenue: $${state.total_revenue.toFixed(3)}
- Total Costs: $${state.total_costs.toFixed(3)}
- Profit: $${(state.total_revenue - state.total_costs).toFixed(3)}
- Avg Margin: ${avgMargin.toFixed(1)}%
- Balance Trend: ${balanceTrend}

**Brain Usage:**
- Wake-ups: ${state.total_brain_wakeups}
- Brain Cost: $${state.total_brain_cost.toFixed(3)}

**Current Strategy:**
- Target Margin: ${policy?.bidding?.target_margin !== undefined ? `${(policy.bidding.target_margin * 100).toFixed(0)}%` : 'not set'}
- Min Margin: ${policy?.bidding?.min_margin !== undefined ? `${(policy.bidding.min_margin * 100).toFixed(0)}%` : 'not set'}
- Skip Below: ${policy?.bidding?.skip_below !== undefined ? `$${policy.bidding.skip_below}` : 'not set'}

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
${partnerships.length > 0 ? partnerships.map((p) => `- ${p.partner_name} (${p.partner_type}) - ${p.split}% split`).join("\n") : "None"}

## YOUR TASK

This is YOUR business review. Think through these questions:

1. **Survival Check:** Is my runway healthy? Am I at risk?

2. **Performance Analysis:** Why am I winning or losing? Is my current strategy working?

3. **Competitive Position:** How do I compare to the market? Am I pricing appropriately?

4. **Opportunity Assessment:** Are there partnerships, market segments, or strategies I should explore?

5. **Strategic Direction:** Should I change anything about my approach? Why or why not?

**Use the tools to gather any additional information you need, then make your decisions.**

If you decide to make changes, use update_policy to implement them.
Document your reasoning with create_investor_update.`;

  return { system, user };
}
