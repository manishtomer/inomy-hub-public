/**
 * Agent Runtime Type Definitions
 *
 * Complete type system for the autonomous agent runtime.
 * These types support the policy-driven architecture where an Autopilot Engine
 * handles 95% of decisions using simple rules, while a Brain (Claude LLM)
 * wakes only for scheduled strategic reviews (QBR), exceptions, and novel situations.
 *
 * Last Updated: 2026-02-05
 */

import type { AgentType, AgentStatus } from "@/types/database";

// ============================================================================
// PERSONALITY & POLICY
// ============================================================================

/**
 * Agent personality types that define behavioral defaults
 */
export type PersonalityType =
  | "risk-taker"
  | "conservative"
  | "profit-maximizer"
  | "volume-chaser"
  | "opportunist"
  | "partnership-oriented"
  | "balanced"
  | "aggressive"
  | "opportunistic";

/**
 * Complete agent policy definition
 * Drives all autopilot decision-making and brain strategic thinking
 */
export interface AgentPolicy {
  /** Identity configuration */
  identity: {
    personality: PersonalityType;
  };

  /** Bidding strategy parameters */
  bidding: {
    target_margin: number; // Target profit margin (0.0-1.0)
    min_margin: number; // Minimum acceptable margin (0.0-1.0)
    skip_below: number; // Skip auctions with max_bid below this
    formula: "percentage" | "fixed"; // Bidding calculation method
  };

  /** Partnership management rules */
  partnerships: {
    auto_accept: {
      min_reputation: number; // Minimum partner reputation to auto-accept
      min_split: number; // Minimum share percentage to auto-accept
    };
    auto_reject: {
      max_reputation: number; // Max reputation below which to auto-reject
      blocked_agents: string[]; // Agent IDs to never partner with
    };
    require_brain: {
      high_value_threshold: number; // Reputation above which to wake brain
    };
    propose: {
      target_types: string[]; // Agent types to seek partnerships with
      default_split: number; // Default proposed split percentage
      min_acceptable_split: number; // Minimum split to accept in counter-offer
    };
  };

  /** Task execution parameters */
  execution: {
    max_cost_per_task: number; // Maximum cost willing to spend on a task
    quality_threshold: number; // Quality bar for work output
  };

  /** Exception triggers for brain wake-up */
  exceptions: {
    consecutive_losses: number; // Wake brain after N consecutive losses
    balance_below: number; // Wake brain when balance drops below this
    reputation_drop: number; // Wake brain on reputation drop percent
    win_rate_drop_percent: number; // Wake brain on win rate drop percent
  };

  /** Quarterly Business Review configuration */
  qbr: {
    base_frequency_rounds: number; // Base interval between QBRs
    accelerate_if: {
      volatility_above: number; // Run QBR more often if volatility high
      losses_above: number; // Run QBR more often if losing streak
    };
    decelerate_if: {
      stable_rounds: number; // Run QBR less often if stable this long
    };
  };
}

// ============================================================================
// COST STRUCTURE
// ============================================================================

/**
 * Agent cost structure per operation type
 * Different agent types have different costs
 */
export interface AgentCostStructure {
  /** Per-task execution costs */
  per_task: {
    llm_inference: number; // Cost of LLM inference for task
    data_retrieval: number; // Cost of data retrieval
    storage: number; // Cost of storing results
    submission: number; // Cost of submitting work
  };

  /** Per-bid costs */
  per_bid: {
    bid_submission: number; // Cost to submit a bid
  };

  /** Periodic overhead costs */
  periodic: {
    brain_wakeup: number; // Cost of waking the brain (Claude API call)
    idle_overhead: number; // Per-round overhead when idle
  };
}

// ============================================================================
// AGENT RUNTIME STATE
// ============================================================================

/**
 * Runtime state tracking for an agent
 * Persisted to agent_runtime_state table
 */
export interface AgentRuntimeState {
  agent_id: string;
  current_round: number;
  consecutive_losses: number;
  consecutive_wins: number;
  total_bids: number;
  total_wins: number;
  total_revenue: number;
  total_costs: number;
  total_brain_wakeups: number;
  total_brain_cost: number;
  total_policy_changes: number;
  win_rate_last_20: number;
  reputation_at_last_check: number;
  win_rate_at_last_check: number;
  is_running: boolean;
  last_active_at: string | null;
  /** Round when brain last woke up (for cooldown enforcement) */
  last_brain_wakeup_round: number;
  /** Round when policy was last changed (for "since last change" tracking) */
  last_policy_change_round: number;
  /** Snapshot of key metrics at the time of last policy change */
  metrics_at_last_change: {
    win_rate: number;
    balance: number;
    consecutive_losses: number;
    target_margin: number;
  } | null;
}

/**
 * Agent identity loaded at startup
 * Combines data from agents table and agent_policies table
 */
export interface AgentIdentity {
  id: string;
  name: string;
  type: AgentType;
  personality: PersonalityType;
  wallet_address: string;
  chain_agent_id: number | null;
  balance: number;
  reputation: number;
  status: AgentStatus;
}

// ============================================================================
// AUTOPILOT DECISIONS
// ============================================================================

/**
 * Autopilot decision for auction bidding
 * Either bid at calculated amount or skip with reasoning
 */
export type BidDecision =
  | { action: "bid"; amount: number; reasoning: string }
  | { action: "skip"; reasoning: string };

/**
 * Autopilot decision for partnership proposals
 * Auto-accept, auto-reject, or escalate to brain
 */
export type PartnershipDecision =
  | { action: "accept"; reasoning: string }
  | { action: "reject"; reasoning: string }
  | { action: "wake_brain"; reasoning: string };

/**
 * Exception types that can trigger brain wake-up
 */
export type ExceptionType =
  | "consecutive_losses"
  | "low_balance"
  | "reputation_drop"
  | "win_rate_drop";

/**
 * Exception trigger details
 */
export interface ExceptionTrigger {
  type: ExceptionType;
  details: string;
  current_value: number;
  threshold: number;
}

// ============================================================================
// BRAIN OUTPUTS
// ============================================================================

/**
 * Brain output for policy updates
 * Returned from exception handling and initial policy generation
 */
export interface BrainPolicyUpdate {
  updated_policy: Partial<AgentPolicy>;
  reasoning: string;
  investor_update: InvestorUpdateData;
}

/**
 * Brain output from Quarterly Business Review
 * Strategic analysis and policy adjustments
 */
export interface QBRResult {
  policy_changes: Partial<AgentPolicy>;
  partnership_actions: PartnershipAction[];
  reasoning: string;
  investor_update: InvestorUpdateData;
}

/**
 * Partnership action from brain strategic thinking
 */
export interface PartnershipAction {
  action: "seek" | "exit" | "renegotiate";
  target_agent_id?: string;
  proposed_split?: number;
  reasoning: string;
}

// ============================================================================
// INVESTOR UPDATES
// ============================================================================

/**
 * Investor transparency update data
 * Generated on every brain wake-up to explain decisions to investors
 */
export interface InvestorUpdateData {
  trigger_type: "qbr" | "exception" | "novel" | "initial";
  trigger_details: string;
  observations: string[];
  changes: InvestorUpdateChange[];
  survival_impact: string;
  growth_impact: string;
  brain_cost: number;
}

/**
 * Individual change documented in investor update
 */
export interface InvestorUpdateChange {
  category: "bidding" | "partnership" | "strategy" | "policy" | "philosophy";
  description: string;
  reasoning: string;
}

// ============================================================================
// RUNNER CONFIGURATION
// ============================================================================

/**
 * Runtime configuration
 * Controls how the agent runtime operates
 */
export interface RuntimeConfig {
  demo_mode: boolean; // If true, actions write to DB only (no blockchain)
  use_blockchain: boolean; // If true, real USDC transfers at task completion (cost sink + escrow)
  poll_interval_ms: number; // How often to check for new events (default: 5000)
  round_duration_ms: number; // How long a "round" is (default: 15000)
  max_agents: number; // Max concurrent agents (default: 8)
  anthropic_api_key: string; // Claude API key
  anthropic_model: string; // Model to use (default: "claude-sonnet-4-20250514")
  log_level: "debug" | "info" | "warn" | "error";
}

// ============================================================================
// ACTION RESULTS
// ============================================================================

/**
 * Result from executing an action (bid, partnership, etc.)
 */
export interface ActionResult {
  success: boolean;
  tx_hash?: string;
  error?: string;
  cost?: number;
}
