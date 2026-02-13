/**
 * Wake-Up Context Types
 *
 * Defines the complete context structure that gets built when the agent brain
 * wakes up for QBRs, exceptions, or novel situations.
 *
 * This context is the "input" to the brain - everything the agent needs to know
 * to make strategic decisions.
 *
 * Created: 2026-02-06
 */

import type { AgentPolicy } from './types';

/**
 * Complete wake-up context provided to the brain
 * Contains all information needed for strategic decision-making
 */
export interface WakeUpContext {
  // === IDENTITY BLOCK ===
  identity: {
    id: string;
    name: string;
    type: string;
    personality: string;
    balance: number;
    reputation: number;
    status: string;
    behavioral_prompt: string; // Personality-specific guidance text
  };

  // === CURRENT STATE ===
  state: {
    current_round: number;
    consecutive_losses: number;
    consecutive_wins: number;
    win_rate_last_20: number;
    wins_last_10: number;           // wins in the last 10 rounds (recent trend)
    total_wins: number;
    total_losses: number;
    win_rate_lifetime: number;      // lifetime win rate as percentage (0-100)
    total_revenue: number;
    total_costs: number;
    profit: number;
    runway_rounds: number; // How many rounds agent can survive
  };

  // === MARKET CONTEXT ===
  market: {
    avg_winning_bid: number;        // average across ALL historical winning bids
    avg_winning_bid_recent: number; // average across only the last 5 winning bids
    price_trend: string;            // "rising" | "stable" | "falling" (recent vs historical)
    competitor_count: number;
    demand_trend: string; // "increasing" | "stable" | "declining"
    price_compression: number; // Percentage change in avg winning bid
    competitor_health: Array<{      // Health snapshot of same-type competitors
      name: string;
      balance: number;
      balance_status: 'healthy' | 'low' | 'critical';
      win_rate: number;
      avg_bid: number;
      reputation: number;           // competitor's reputation (0-5)
      bid_score: number;            // auction score at their avg bid
    }>;
  };

  // === CURRENT POLICY ===
  policy: AgentPolicy;

  // === NARRATIVE SUMMARIES ===
  situation_summary: string; // Why the brain is waking up
  market_narrative: string; // Current market conditions in narrative form

  // === INDUSTRY MEMORY (shared events with narratives) ===
  industry_memories: Array<{
    round_number: number;
    event_type: string;
    data: Record<string, unknown>;
    narrative: string;
    severity: string;
  }>;

  // === PERSONAL MEMORY (individual history with narratives) ===
  personal_memories: {
    recent_bids: Array<{
      round_number: number;
      data: Record<string, unknown>;
      narrative: string;
      importance_score: number;
    }>;
    key_learnings: Array<{
      round_number: number;
      data: Record<string, unknown>;
      narrative: string;
      importance_score: number;
    }>;
    partnership_history: Array<{
      round_number: number;
      data: Record<string, unknown>;
      narrative: string;
    }>;
    recent_exceptions: Array<{
      round_number: number;
      data: Record<string, unknown>;
      narrative: string;
    }>;
    qbr_insights: Array<{
      round_number: number;
      data: Record<string, unknown>;
      narrative: string;
    }>;
  };

  // === ACTIVE PARTNERSHIPS ===
  partnerships: Array<{
    partnerId: string;
    partnerName: string;
    partnerType: string;
    split: number;
    jointWinRate: number;
  }>;

  // === ECONOMICS (cost awareness for strategic reasoning) ===
  economics: {
    // Cost breakdown per round
    fixed_cost_per_round: number;       // living + brain amortized (paid every round regardless)
    living_cost: number;                // $0.005/round
    brain_cost_amortized: number;       // brain_wakeup * recent_wakeup_rate
    bid_cost_per_bid: number;           // $0.001 per bid placed
    task_cost: number;                  // operational cost when winning (LLM + data + storage)
    investor_share_pct: number;         // % of gross profit taken by investors (0-100)

    // Win economics
    avg_revenue_per_win: number;        // avg bid amount on won tasks
    avg_profit_per_win: number;         // revenue - task_cost (before investor share)
    avg_agent_take_per_win: number;     // profit after investor share
    wins_per_round: number;             // actual wins / rounds played (< 1 means idle rounds)
    bids_per_round: number;             // actual bids / rounds played
    type_match_rate: number;            // fraction of tasks matching agent type (0-1)

    // Survival math
    min_profitable_bid: number;         // absolute floor — any bid below this loses money guaranteed
    all_in_cost: number;                // actual bid base used by autopilot (task+bid+living+brain)
    net_per_round: number;              // avg agent take - avg fixed costs (negative = dying)
    rounds_until_death: number;         // balance / abs(net_per_round) if negative
    break_even_wins_per_round: number;  // fixed costs / agent_take_per_win

    // Bid feedback (what the policy actually produces)
    your_last_bid: number;              // actual bid amount from most recent bid
    your_last_bid_score: number;        // auction score at that bid
    your_bid_at_target_margin: number;  // bid = allInCost / (1 - target_margin)

    // Total cost breakdown (lifetime)
    total_living_costs: number;
    total_brain_costs: number;
    total_bid_costs: number;
    total_task_costs: number;
    total_investor_share: number;
  };

  // === SINCE LAST CHANGE (feedback on previous brain decisions) ===
  since_last_change: {
    rounds_ago: number;              // how many rounds since last policy change
    policy_change_round: number;     // which round the change was made
    before: {
      win_rate: number;
      balance: number;
      consecutive_losses: number;
      target_margin: number;
    };
    after: {
      win_rate: number;
      balance: number;
      consecutive_losses: number;
      wins_since: number;
      losses_since: number;
    };
  } | null;

  // === TRIGGER INFO ===
  trigger: {
    type: 'qbr' | 'exception' | 'novel' | 'initial';
    details: string;
    urgency: 'low' | 'medium' | 'high' | 'critical';
  };
}

/**
 * Trigger urgency level
 */
export type TriggerUrgency = 'low' | 'medium' | 'high' | 'critical';

/**
 * Trigger type
 */
export type TriggerType = 'qbr' | 'exception' | 'novel' | 'initial';
