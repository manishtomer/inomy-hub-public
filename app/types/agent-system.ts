/**
 * Extended type definitions for QBR (Quarterly Business Review) system
 * Includes policy tracking, investor updates, QBR history, and exception management
 */

import type { AgentType, AgentStatus } from './database';

// ============================================================================
// PERSONALITY & POLICY TYPES
// ============================================================================

export type PersonalityType =
  | 'risk-taker'
  | 'conservative'
  | 'profit-maximizer'
  | 'volume-chaser'
  | 'opportunist'
  | 'partnership-oriented';

export type ExceptionType =
  | 'consecutive_losses'
  | 'low_balance'
  | 'reputation_drop'
  | 'win_rate_drop'
  | 'unknown_situation';

// ============================================================================
// POLICY DEFINITIONS
// ============================================================================

export interface AgentPolicy {
  identity: {
    personality: PersonalityType;
  };

  bidding: {
    target_margin: number;          // e.g., 0.15 for 15%
    min_margin: number;             // e.g., 0.08 for 8%
    skip_below: number;             // e.g., 0.05 for $0.05
    formula: 'percentage' | 'fixed';
  };

  partnerships: {
    auto_accept: {
      min_reputation: number;       // e.g., 4.0
      min_split: number;            // e.g., 0.45 for 45%
    };
    auto_reject: {
      max_reputation: number;       // e.g., 3.0
      blocked_agents: string[];
    };
    require_brain: {
      high_value_threshold: number; // rep > 4.5 → wake brain
    };
    propose: {
      target_types: string[];
      default_split: number;        // e.g., 0.50
      min_acceptable_split: number; // e.g., 0.40
    };
  };

  execution: {
    max_cost_per_task: number;      // abort if cost exceeds
    quality_threshold: number;      // min quality before submitting
  };

  exceptions: {
    consecutive_losses: number;     // risk-taker: 8, conservative: 3
    balance_below: number;          // e.g., 0.20
    reputation_drop: number;        // e.g., 0.5
    win_rate_drop_percent: number;  // e.g., 20
  };

  qbr: {
    base_frequency_rounds: number;  // e.g., 10
    accelerate_if: {
      volatility_above: number;
      losses_above: number;
    };
    decelerate_if: {
      stable_rounds: number;
    };
  };
}

// Default personality thresholds
export const PERSONALITY_DEFAULTS: Record<PersonalityType, Partial<AgentPolicy['exceptions']>> = {
  'risk-taker': { consecutive_losses: 8, balance_below: 0.10 },
  'conservative': { consecutive_losses: 3, balance_below: 0.30 },
  'profit-maximizer': { consecutive_losses: 5, balance_below: 0.25 },
  'volume-chaser': { consecutive_losses: 10, balance_below: 0.15 },
  'opportunist': { consecutive_losses: 5, balance_below: 0.20 },
  'partnership-oriented': { consecutive_losses: 4, balance_below: 0.20 },
};

// ============================================================================
// POLICY CHANGE & VERSION TRACKING
// ============================================================================

export interface PolicyVersion {
  id: string;
  agent_id: string;
  policy_json: AgentPolicy;
  version: number;
  is_current: boolean;

  trigger: {
    type: 'qbr' | 'exception' | 'initial' | 'partnership';
    details: string;
  };

  reasoning: PolicyChangeReasoning;
  brain_cost: number;

  created_at: string;
  updated_at: string;
}

export interface PolicyChangeReasoning {
  observations: string[];
  analysis: string;
  decision: string;
  changes: PolicyChangeSummary[];
  survival_impact: string;
  growth_impact: string;
}

export interface PolicyChangeSummary {
  field: string;
  old_value: unknown;
  new_value: unknown;
  reasoning: string;
}

// ============================================================================
// INVESTOR UPDATES
// ============================================================================

export interface InvestorUpdate {
  id: string;
  agent_id: string;
  agent_name: string;

  trigger: {
    type: 'qbr' | 'exception' | 'partnership' | 'initial';
    description: string;
  };

  health_snapshot: {
    survival_status: 'healthy' | 'caution' | 'critical';
    balance: number;
    runway_rounds: number;
    win_rate: number;
    reputation: number;
  };

  observations: string[];
  changes: InvestorUpdateChangeDetail[];

  impacts: {
    survival: string;
    growth: string;
    risk: string;
  };

  next_steps: string;

  brain_cost: number;
  created_at: string;
}

export interface InvestorUpdateChangeDetail {
  category: 'bidding' | 'partnership' | 'strategy' | 'policy' | 'philosophy';
  description: string;
  reasoning: string;
  impact: string;
}

// ============================================================================
// QBR RECORDS
// ============================================================================

export interface QBRRecord {
  id: string;
  agent_id: string;
  qbr_number: number;

  period: {
    rounds_since_last: number;
    start_round: number;
    end_round: number;
  };

  input_metrics: {
    win_rate_start: number;
    win_rate_end: number;
    balance_start: number;
    balance_end: number;
    reputation_start: number;
    reputation_end: number;
  };

  decisions: {
    partnership_action?: 'seek' | 'exit' | 'renegotiate' | 'none';
    partnership_target?: string;
    strategy_changes?: Record<string, { old: unknown; new: unknown }>;
    philosophy_change: boolean;
  };

  outcome?: {
    actual_win_rate: number;
    actual_balance_change: number;
    success: boolean;
  };

  created_at: string;
}

// ============================================================================
// EXCEPTION RECORDS
// ============================================================================

export interface ExceptionRecord {
  id: string;
  agent_id: string;

  exception: {
    type: ExceptionType;
    details: string;
    current_value: number;
    threshold: number;
  };

  brain_response: {
    policy_changes: Partial<AgentPolicy>;
    partnership_action?: 'seek' | 'exit' | 'none';
    reasoning: string;
  };

  resolution: {
    resolved: boolean;
    resolved_at?: string;
    time_to_resolution_rounds?: number;
  };

  created_at: string;
}

// ============================================================================
// TOOL INPUTS & OUTPUTS
// ============================================================================

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
    // Overall market health
    total_agents?: number;
    active_agents?: number;
    agent_survival_rate?: number;
  };

  // Your position in this market (only if agent_id provided)
  my_position?: {
    win_rate: number;
    win_rate_rank: number;
    total_bids: number;
    total_wins: number;
    avg_bid: number;
    avg_bid_vs_market: number;
    market_share: number;
    consecutive_losses: number;
    balance_runway: number;
  };

  // Human-readable analysis
  analysis: string;
}

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

export interface GetMyStatsInput {
  agent_id: string;
  stat_window_rounds: number;
}

export interface GetMyStatsOutput {
  name: string;
  type: AgentType;
  personality: PersonalityType;
  current_balance: number;
  total_revenue_this_period: number;
  total_costs_this_period: number;
  profit_margin_avg: number;
  runway_estimated_rounds: number;
  bids_submitted: number;
  bids_won: number;
  win_rate: number;
  consecutive_losses_current: number;
  tasks_completed_this_period: number;
  tasks_failed_this_period: number;
  completion_rate: number;
  reputation: number;
  reputation_change_this_period: number;
  status: AgentStatus;
  current_policy: {
    target_margin: number;
    min_margin: number;
    skip_below: number;
  };
  avg_cost_per_winning_bid: number;
  avg_revenue_per_winning_bid: number;
  avg_brain_cost_per_wakeup: number;
  active_partnership_count: number;
  partnership_revenue_share: number;
  solo_vs_partnership_win_rate: {
    solo: number;
    partnership: number;
  };
  exception_flags: Array<{
    type: ExceptionType;
    triggered: boolean;
    current_value: number;
    threshold: number;
  }>;
  // Computed bid economics — so brain doesn't have to guess
  bid_economics: {
    all_in_cost: number;              // actual base the autopilot uses for bid = task + bid + living + brain
    current_bid_at_policy: number;    // all_in_cost / (1 - target_margin) — what you're ACTUALLY bidding
    current_bid_score: number;        // (100 + rep*2) / current_bid — your auction score
    min_profitable_bid: number;       // task_cost + bid_cost — floor below which you lose money
  };
}

export interface GetQBRContextInput {
  agent_id: string;
  include_partnership_recommendations?: boolean;
}

export interface GetQBRContextOutput {
  rounds_since_last_qbr: number;
  qbr_number: number;
  balance_start_period: number;
  balance_end_period: number;
  balance_trend: 'growing' | 'stable' | 'declining';
  runway_trend: 'improving' | 'stable' | 'critical';
  win_rate_start: number;
  win_rate_end: number;
  win_rate_change: number;
  market_position: 'leader' | 'competitive' | 'struggling';
  reputation_start: number;
  reputation_end: number;
  reputation_change: number;
  recent_losses: number;
  market_competition: 'increasing' | 'stable' | 'decreasing';
  price_trends: 'tightening' | 'stable' | 'expanding';
  demand_trend: 'growing' | 'stable' | 'declining';
  potential_partners?: Array<{
    partner_id: string;
    partner_name: string;
    partner_type: AgentType;
    fit_score: number;
    fit_reasoning: string;
    complementary_skills: string[];
    reputation: number;
    recommended_split: number;
  }>;
  policy_performance: {
    bidding_stance: 'too_aggressive' | 'appropriate' | 'too_conservative';
    margin_sustainability: 'healthy' | 'declining' | 'critical';
    exception_sensitivity: 'well_tuned' | 'too_sensitive' | 'too_loose';
  };
  comparable_agents: Array<{
    name: string;
    type: AgentType;
    win_rate: number;
    bid_discount: number;
    reputation: number;
  }>;
  // Computed bid economics — so brain doesn't have to guess
  bid_economics: {
    all_in_cost: number;
    current_bid_at_policy: number;
    current_bid_score: number;
    min_profitable_bid: number;
  };
}

export interface PartnershipFitAnalysisInput {
  agent_a_id: string;
  agent_b_id: string;
  proposed_split_a?: number;
}

export interface PartnershipFitAnalysisOutput {
  fit_score: number;
  skill_complementarity: number;
  reputation_fit: number;
  economic_fit: number;
  cultural_fit: number;
  reasoning: string;
  synergies: string[];
  risks: string[];
  estimated_joint_win_rate: number;
  estimated_margin_improvement: number;
  recommendation: 'highly_recommended' | 'worth_exploring' | 'not_recommended';
  suggested_split_a: number;
  suggested_split_b: number;
  alternative_terms: Array<{
    split_a: number;
    split_b: number;
    pros: string[];
    cons: string[];
  }>;
}

export interface PolicyImpactAnalysisInput {
  agent_id: string;
  proposed_policy_changes: Partial<AgentPolicy>;
}

export interface PolicyImpactAnalysisOutput {
  expected_win_rate_change: number;
  expected_margin_change: number;
  expected_runway_change: number;
  worst_case_scenario: string;
  worst_case_win_rate: number;
  worst_case_runway: number;
  best_case_scenario: string;
  best_case_win_rate: number;
  best_case_runway: number;
  impact_summary: string;
  risk_level: 'low' | 'medium' | 'high';
  recommendation: 'proceed' | 'consider_alternatives' | 'not_recommended';
}

export interface UpdatePolicyInput {
  agent_id: string;
  policy_updates: Partial<AgentPolicy>;
  reasoning: string;
  trigger_type: 'qbr' | 'exception' | 'initial' | 'partnership';
  trigger_details: string;
}

export interface UpdatePolicyOutput {
  success: boolean;
  policy_id: string;
  timestamp: string;
  version: number;
  reason_hash: string;
  changes_applied: Array<{
    field: string;
    old_value: unknown;
    new_value: unknown;
  }>;
  bid_impact: {
    target_margin: number;
    all_in_cost: number;
    resulting_bid: number;
    resulting_score: number;
    profit_per_win: number;
    min_profitable_bid: number;
    explanation: string;
  };
  brain_cost: number;
  balance_after: number;
}

export interface ProposePartnershipInput {
  agent_a_id: string;
  agent_b_id: string;
  proposed_split_a: number;
  proposed_split_b: number;
  message?: string;
}

export interface ProposePartnershipOutput {
  success: boolean;
  partnership_id: string;
  status: 'proposed' | 'error';
  partner_a: {
    id: string;
    name: string;
    split: number;
  };
  partner_b: {
    id: string;
    name: string;
    split: number;
  };
  next_steps: string;
}

export interface CreateInvestorUpdateInput {
  agent_id: string;
  trigger_type: 'qbr' | 'exception' | 'partnership' | 'initial';
  observations: string[];
  changes: Array<{
    category: 'bidding' | 'partnership' | 'strategy' | 'policy' | 'philosophy';
    description: string;
    reasoning: string;
  }>;
  survival_impact: string;
  growth_impact: string;
  brain_cost: number;
}

export interface CreateInvestorUpdateOutput {
  success: boolean;
  update_id: string;
  timestamp: string;
  html_summary: string;
  posted_to_profile: boolean;
  notification_sent: boolean;
}

// ============================================================================
// BRAIN TOOL CONTEXT
// ============================================================================

export interface BrainToolContext {
  // Query tools (read-only, no cost) - PHASE 1
  query_market: (input: QueryMarketInput) => Promise<QueryMarketOutput>;
  query_agent: (input: any) => Promise<any>;  // Filter-based search, not ID lookup
  get_my_stats: (input: GetMyStatsInput) => Promise<GetMyStatsOutput>;
  get_qbr_context: (input: GetQBRContextInput) => Promise<GetQBRContextOutput>;
  get_current_partnerships: (input: any) => Promise<any>;  // Get current partnerships (NEW)

  // Analysis tools (read-only, minimal cost)
  partnership_fit_analysis: (
    input: PartnershipFitAnalysisInput
  ) => Promise<PartnershipFitAnalysisOutput>;
  policy_impact_analysis: (
    input: PolicyImpactAnalysisInput
  ) => Promise<PolicyImpactAnalysisOutput>;

  // Action tools (modify state, cost-bearing) - PHASE 2
  update_policy: (input: UpdatePolicyInput) => Promise<UpdatePolicyOutput>;
  propose_partnership: (input: any) => Promise<any>;  // Uses target_agent_name, not agent IDs
  kill_partnership: (input: any) => Promise<any>;  // End partnership (NEW)
  create_investor_update: (
    input: CreateInvestorUpdateInput
  ) => Promise<CreateInvestorUpdateOutput>;
}
