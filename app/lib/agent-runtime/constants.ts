/**
 * Agent Runtime Constants
 *
 * Cost structures, personality defaults, and runtime configuration defaults.
 * Values are derived from implementation-plans/agent-runtime-implementation.md
 * and implementation-plans/agent-architecture.md.
 *
 * Last Updated: 2026-02-05
 */

import { AgentType } from "@/types/database";
import type {
  AgentCostStructure,
  AgentPolicy,
  PersonalityType,
  RuntimeConfig,
} from "./types";

// ============================================================================
// COST STRUCTURES PER AGENT TYPE
// ============================================================================

/**
 * Cost structures for each agent type
 * Based on the different computational and operational requirements
 */
export const AGENT_COSTS: Record<AgentType, AgentCostStructure> = {
  [AgentType.CATALOG]: {
    per_task: {
      llm_inference: 0.03,
      data_retrieval: 0.02,
      storage: 0.005,
      submission: 0.002,
    },
    per_bid: {
      bid_submission: 0.001,
    },
    periodic: {
      brain_wakeup: 0.001,
      idle_overhead: 0.001,
    },
  },
  [AgentType.REVIEW]: {
    per_task: {
      llm_inference: 0.04,
      data_retrieval: 0.025,
      storage: 0.005,
      submission: 0.002,
    },
    per_bid: {
      bid_submission: 0.001,
    },
    periodic: {
      brain_wakeup: 0.001,
      idle_overhead: 0.001,
    },
  },
  [AgentType.CURATION]: {
    per_task: {
      llm_inference: 0.05,
      data_retrieval: 0.01,
      storage: 0.005,
      submission: 0.002,
    },
    per_bid: {
      bid_submission: 0.001,
    },
    periodic: {
      brain_wakeup: 0.001,
      idle_overhead: 0.001,
    },
  },
  [AgentType.SELLER]: {
    per_task: {
      llm_inference: 0.02,
      data_retrieval: 0.005,
      storage: 0.002,
      submission: 0.002,
    },
    per_bid: {
      bid_submission: 0.001,
    },
    periodic: {
      brain_wakeup: 0.001,
      idle_overhead: 0.001,
    },
  },
  [AgentType.PLATFORM]: {
    per_task: { llm_inference: 0, data_retrieval: 0, storage: 0, submission: 0 },
    per_bid: { bid_submission: 0 },
    periodic: { brain_wakeup: 0, idle_overhead: 0 },
  },
};

// ============================================================================
// PERSONALITY DEFAULTS
// ============================================================================

/**
 * Default policies for each personality type
 * Each personality has different risk tolerance, bidding behavior, and strategic goals
 */
// Legacy personality names (used by existing agents in DB)
// Maps to similar behavior patterns
export const PERSONALITY_DEFAULTS: Record<string, AgentPolicy> = {
  // "balanced" is a middle-ground personality - moderate risk, moderate margins
  balanced: {
    identity: {
      personality: "balanced",
    },
    bidding: {
      target_margin: 0.20,
      min_margin: 0.14,
      skip_below: 0.001,
      formula: "percentage",
    },
    partnerships: {
      auto_accept: {
        min_reputation: 2.5,
        min_split: 48,
      },
      auto_reject: {
        max_reputation: 1.5,
        blocked_agents: [],
      },
      require_brain: {
        high_value_threshold: 4.0,
      },
      propose: {
        target_types: ["CATALOG", "REVIEW", "CURATION", "SELLER"],
        default_split: 50,
        min_acceptable_split: 45,
      },
    },
    execution: {
      max_cost_per_task: 0.07,
      quality_threshold: 0.8,
    },
    exceptions: {
      consecutive_losses: 5,
      balance_below: 0.2,
      reputation_drop: 0.8,
      win_rate_drop_percent: 15,
    },
    qbr: {
      base_frequency_rounds: 10,
      accelerate_if: {
        volatility_above: 0.25,
        losses_above: 4,
      },
      decelerate_if: {
        stable_rounds: 16,
      },
    },
  },

  // "aggressive" is more risk-tolerant, lower margins, wins volume
  aggressive: {
    identity: {
      personality: "aggressive",
    },
    bidding: {
      target_margin: 0.16,
      min_margin: 0.10,
      skip_below: 0.001,
      formula: "percentage",
    },
    partnerships: {
      auto_accept: {
        min_reputation: 2.0,
        min_split: 40,
      },
      auto_reject: {
        max_reputation: 1.0,
        blocked_agents: [],
      },
      require_brain: {
        high_value_threshold: 4.5,
      },
      propose: {
        target_types: ["CATALOG", "REVIEW", "CURATION", "SELLER"],
        default_split: 50,
        min_acceptable_split: 35,
      },
    },
    execution: {
      max_cost_per_task: 0.1,
      quality_threshold: 0.7,
    },
    exceptions: {
      consecutive_losses: 8,
      balance_below: 0.1,
      reputation_drop: 1.5,
      win_rate_drop_percent: 25,
    },
    qbr: {
      base_frequency_rounds: 12,
      accelerate_if: {
        volatility_above: 0.3,
        losses_above: 6,
      },
      decelerate_if: {
        stable_rounds: 20,
      },
    },
  },

  // "opportunistic" - alias for "opportunist"
  opportunistic: {
    identity: {
      personality: "opportunistic",
    },
    bidding: {
      target_margin: 0.18,
      min_margin: 0.12,
      skip_below: 0.001,
      formula: "percentage",
    },
    partnerships: {
      auto_accept: {
        min_reputation: 2.5,
        min_split: 48,
      },
      auto_reject: {
        max_reputation: 1.25,
        blocked_agents: [],
      },
      require_brain: {
        high_value_threshold: 4.0,
      },
      propose: {
        target_types: ["REVIEW", "CURATION", "SELLER"],
        default_split: 55,
        min_acceptable_split: 40,
      },
    },
    execution: {
      max_cost_per_task: 0.08,
      quality_threshold: 0.75,
    },
    exceptions: {
      consecutive_losses: 5,
      balance_below: 0.2,
      reputation_drop: 1.0,
      win_rate_drop_percent: 18,
    },
    qbr: {
      base_frequency_rounds: 10,
      accelerate_if: {
        volatility_above: 0.25,
        losses_above: 4,
      },
      decelerate_if: {
        stable_rounds: 16,
      },
    },
  },

  "risk-taker": {
    identity: {
      personality: "risk-taker",
    },
    bidding: {
      target_margin: 0.16, // Lower margin - aggressive bidding
      min_margin: 0.10, // Minimum to stay profitable
      skip_below: 0.001, // Almost never skip
      formula: "percentage",
    },
    partnerships: {
      auto_accept: {
        min_reputation: 2.0, // Lower bar for partners (0-5 scale)
        min_split: 40, // Accept lower splits
      },
      auto_reject: {
        max_reputation: 1.0, // Only reject very low reputation (0-5 scale)
        blocked_agents: [],
      },
      require_brain: {
        high_value_threshold: 4.5, // Only escalate for very high reputation (0-5 scale)
      },
      propose: {
        target_types: ["CATALOG", "REVIEW", "CURATION", "SELLER"], // Open to all
        default_split: 50, // Fair split
        min_acceptable_split: 35, // Will accept less
      },
    },
    execution: {
      max_cost_per_task: 0.1,
      quality_threshold: 0.7, // Lower quality bar for speed
    },
    exceptions: {
      consecutive_losses: 8, // High tolerance for losses
      balance_below: 0.1, // Low balance threshold
      reputation_drop: 1.5, // Allow significant reputation drop (0-5 scale)
      win_rate_drop_percent: 25, // Tolerate big win rate drops
    },
    qbr: {
      base_frequency_rounds: 12, // Less frequent reviews
      accelerate_if: {
        volatility_above: 0.3,
        losses_above: 6,
      },
      decelerate_if: {
        stable_rounds: 20,
      },
    },
  },

  conservative: {
    identity: {
      personality: "conservative",
    },
    bidding: {
      target_margin: 0.25, // High margin - cautious bidding
      min_margin: 0.18, // High minimum
      skip_below: 0.002, // Skip very low-value auctions
      formula: "percentage",
    },
    partnerships: {
      auto_accept: {
        min_reputation: 3.5, // High bar for partners (0-5 scale)
        min_split: 55, // Require favorable splits
      },
      auto_reject: {
        max_reputation: 2.0, // Reject below-average reputation (0-5 scale)
        blocked_agents: [],
      },
      require_brain: {
        high_value_threshold: 4.25, // (0-5 scale)
      },
      propose: {
        target_types: ["CATALOG", "REVIEW"], // Conservative partner choices
        default_split: 60, // Favorable to us
        min_acceptable_split: 50, // Only fair or better
      },
    },
    execution: {
      max_cost_per_task: 0.05,
      quality_threshold: 0.9, // High quality bar
    },
    exceptions: {
      consecutive_losses: 3, // Low tolerance for losses
      balance_below: 0.3, // High balance threshold
      reputation_drop: 0.5, // Very sensitive to reputation (0-5 scale)
      win_rate_drop_percent: 10, // Quick to react to performance drops
    },
    qbr: {
      base_frequency_rounds: 8, // More frequent reviews
      accelerate_if: {
        volatility_above: 0.2,
        losses_above: 2,
      },
      decelerate_if: {
        stable_rounds: 15,
      },
    },
  },

  "profit-maximizer": {
    identity: {
      personality: "profit-maximizer",
    },
    bidding: {
      target_margin: 0.22, // High margin targeting
      min_margin: 0.16, // Won't go below 16%
      skip_below: 0.002, // Skip very small opportunities
      formula: "percentage",
    },
    partnerships: {
      auto_accept: {
        min_reputation: 3.0, // (0-5 scale)
        min_split: 52, // Slight advantage required
      },
      auto_reject: {
        max_reputation: 1.5, // (0-5 scale)
        blocked_agents: [],
      },
      require_brain: {
        high_value_threshold: 4.0, // (0-5 scale)
      },
      propose: {
        target_types: ["CATALOG", "CURATION"], // Strategic pairings
        default_split: 58, // Negotiate from strength
        min_acceptable_split: 48, // Slight disadvantage acceptable if profitable
      },
    },
    execution: {
      max_cost_per_task: 0.07,
      quality_threshold: 0.85, // High quality for premium pricing
    },
    exceptions: {
      consecutive_losses: 5,
      balance_below: 0.25,
      reputation_drop: 0.8, // 0-5 scale
      win_rate_drop_percent: 15,
    },
    qbr: {
      base_frequency_rounds: 10,
      accelerate_if: {
        volatility_above: 0.25,
        losses_above: 4,
      },
      decelerate_if: {
        stable_rounds: 18,
      },
    },
  },

  "volume-chaser": {
    identity: {
      personality: "volume-chaser",
    },
    bidding: {
      target_margin: 0.15, // Lower margin - maximize volume
      min_margin: 0.10, // Floor to stay profitable
      skip_below: 0.001, // Almost never skip
      formula: "percentage",
    },
    partnerships: {
      auto_accept: {
        min_reputation: 1.75, // Low bar - wants partnerships (0-5 scale)
        min_split: 35, // Accept unfavorable splits for volume
      },
      auto_reject: {
        max_reputation: 0.75, // Only reject very poor reputation (0-5 scale)
        blocked_agents: [],
      },
      require_brain: {
        high_value_threshold: 4.75, // Rarely escalate (0-5 scale)
      },
      propose: {
        target_types: ["CATALOG", "REVIEW", "CURATION", "SELLER"], // Partner with anyone
        default_split: 45, // Generous to secure partnerships
        min_acceptable_split: 30, // Will take bad deals for volume
      },
    },
    execution: {
      max_cost_per_task: 0.08,
      quality_threshold: 0.65, // Lower quality bar for speed
    },
    exceptions: {
      consecutive_losses: 10, // Very high tolerance
      balance_below: 0.15,
      reputation_drop: 1.2, // 0-5 scale
      win_rate_drop_percent: 20,
    },
    qbr: {
      base_frequency_rounds: 15, // Least frequent reviews
      accelerate_if: {
        volatility_above: 0.35,
        losses_above: 8,
      },
      decelerate_if: {
        stable_rounds: 25,
      },
    },
  },

  opportunist: {
    identity: {
      personality: "opportunist",
    },
    bidding: {
      target_margin: 0.18, // Moderate margin
      min_margin: 0.12, // Flexible on margin
      skip_below: 0.001, // Skip very small auctions
      formula: "percentage",
    },
    partnerships: {
      auto_accept: {
        min_reputation: 2.5, // Average bar (0-5 scale)
        min_split: 48, // Slightly below fair
      },
      auto_reject: {
        max_reputation: 1.25, // (0-5 scale)
        blocked_agents: [],
      },
      require_brain: {
        high_value_threshold: 4.0, // (0-5 scale)
      },
      propose: {
        target_types: ["REVIEW", "CURATION", "SELLER"], // Opportunistic targeting
        default_split: 55, // Slight advantage
        min_acceptable_split: 40, // Flexible
      },
    },
    execution: {
      max_cost_per_task: 0.08,
      quality_threshold: 0.75, // Balanced quality
    },
    exceptions: {
      consecutive_losses: 5,
      balance_below: 0.2,
      reputation_drop: 1.0, // 0-5 scale
      win_rate_drop_percent: 18,
    },
    qbr: {
      base_frequency_rounds: 10,
      accelerate_if: {
        volatility_above: 0.25,
        losses_above: 4,
      },
      decelerate_if: {
        stable_rounds: 16,
      },
    },
  },

  "partnership-oriented": {
    identity: {
      personality: "partnership-oriented",
    },
    bidding: {
      target_margin: 0.20, // Moderate-high margin
      min_margin: 0.15, // Reasonable minimum
      skip_below: 0.002, // Skip low-value auctions
      formula: "percentage",
    },
    partnerships: {
      auto_accept: {
        min_reputation: 2.25, // Lower bar - values partnerships (0-5 scale)
        min_split: 45, // Generous to partners
      },
      auto_reject: {
        max_reputation: 1.5, // (0-5 scale)
        blocked_agents: [],
      },
      require_brain: {
        high_value_threshold: 3.75, // Escalate more often for strategic fit (0-5 scale)
      },
      propose: {
        target_types: ["CATALOG", "REVIEW", "CURATION"], // Strategic complementary types
        default_split: 50, // Fair splits
        min_acceptable_split: 42, // Reasonable flexibility
      },
    },
    execution: {
      max_cost_per_task: 0.06,
      quality_threshold: 0.82, // High quality to maintain relationships
    },
    exceptions: {
      consecutive_losses: 4, // Lower tolerance - values stability
      balance_below: 0.2,
      reputation_drop: 0.7, // Sensitive to reputation for partnerships (0-5 scale)
      win_rate_drop_percent: 12,
    },
    qbr: {
      base_frequency_rounds: 8, // Frequent reviews for strategic planning
      accelerate_if: {
        volatility_above: 0.22,
        losses_above: 3,
      },
      decelerate_if: {
        stable_rounds: 14,
      },
    },
  },
};

// ============================================================================
// RUNTIME DEFAULTS
// ============================================================================

/**
 * Default runtime configuration
 * Can be overridden via environment variables or CLI flags
 */
export const DEFAULT_RUNTIME_CONFIG: Omit<RuntimeConfig, "anthropic_api_key"> = {
  demo_mode: true,
  use_blockchain: false,
  poll_interval_ms: 5000,
  round_duration_ms: 15000,
  max_agents: 8,
  anthropic_model: "claude-sonnet-4-20250514",
  log_level: "info",
};

// ============================================================================
// DATABASE LOADING FUNCTIONS (with hardcoded fallback)
// ============================================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Lazy initialization to avoid build-time errors
let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

/**
 * Load skill costs from database with hardcoded fallback
 */
export async function getSkillCosts(skillCode: string): Promise<AgentCostStructure> {
  try {
    const { data, error } = await getSupabase()
      .from("skills")
      .select("cost_structure")
      .eq("code", skillCode)
      .single();

    if (!error && data?.cost_structure) {
      return {
        per_task: data.cost_structure,
        per_bid: { bid_submission: 0.001 },
        periodic: { brain_wakeup: 0.01, idle_overhead: 0.001 },
      };
    }
  } catch (err) {
    console.warn(`[getSkillCosts] Failed to load from DB, using fallback: ${err}`);
  }

  // Fallback to hardcoded
  return AGENT_COSTS[skillCode as AgentType] || AGENT_COSTS[AgentType.CATALOG];
}

/**
 * Load personality policy from database with hardcoded fallback
 */
export async function getPersonalityPolicy(personalityCode: string): Promise<AgentPolicy> {
  try {
    const { data, error } = await getSupabase()
      .from("personalities")
      .select("default_policy")
      .eq("code", personalityCode)
      .single();

    if (!error && data?.default_policy) {
      return data.default_policy as AgentPolicy;
    }
  } catch (err) {
    console.warn(`[getPersonalityPolicy] Failed to load from DB, using fallback: ${err}`);
  }

  // Fallback to hardcoded
  return PERSONALITY_DEFAULTS[personalityCode as PersonalityType] || PERSONALITY_DEFAULTS.conservative;
}

/**
 * Load behavioral prompt from database with fallback
 */
export async function getBehavioralPrompt(personalityCode: string): Promise<string> {
  try {
    const { data, error } = await getSupabase()
      .from("personalities")
      .select("behavioral_prompt")
      .eq("code", personalityCode)
      .single();

    if (!error && data?.behavioral_prompt) {
      return data.behavioral_prompt;
    }
  } catch (err) {
    console.warn(`[getBehavioralPrompt] Failed to load from DB: ${err}`);
  }

  return `You are a ${personalityCode} agent.`;
}

/**
 * Get list of active skills from database
 */
export async function getActiveSkills(): Promise<Array<{ code: string; name: string }>> {
  try {
    const { data, error } = await getSupabase()
      .from("skills")
      .select("code, name")
      .eq("is_active", true);

    if (!error && data) {
      return data;
    }
  } catch (err) {
    console.warn(`[getActiveSkills] Failed to load from DB: ${err}`);
  }

  // Fallback to hardcoded types
  return Object.values(AgentType).map((code) => ({ code, name: code }));
}

/**
 * Get list of active personalities from database
 */
export async function getActivePersonalities(): Promise<Array<{ code: string; name: string }>> {
  try {
    const { data, error } = await getSupabase()
      .from("personalities")
      .select("code, name")
      .eq("is_active", true);

    if (!error && data) {
      return data;
    }
  } catch (err) {
    console.warn(`[getActivePersonalities] Failed to load from DB: ${err}`);
  }

  // Fallback to hardcoded personalities
  return Object.keys(PERSONALITY_DEFAULTS).map((code) => ({ code, name: code }));
}
