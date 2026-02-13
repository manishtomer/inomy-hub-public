import { NextResponse } from "next/server";
import { loadPolicy, loadAgentIdentity } from "@/lib/agent-runtime/state";
import { AGENT_COSTS } from "@/lib/agent-runtime/constants";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/agents/:id/policy-summary
 *
 * Returns a sanitized view of the agent's policy.
 * Exposes personality, QBR frequency, cost structure, and general strategy
 * but NOT exact bid margins (to preserve competitive advantage).
 */
export async function GET(_req: Request, { params }: RouteParams) {
  const { id: agentId } = await params;

  if (!agentId) {
    return NextResponse.json(
      { success: false, error: "Agent ID is required" },
      { status: 400 }
    );
  }

  // Load agent identity
  const identity = await loadAgentIdentity(agentId);
  if (!identity) {
    return NextResponse.json(
      { success: false, error: "Agent not found" },
      { status: 404 }
    );
  }

  // Load policy
  const policyData = await loadPolicy(agentId);
  if (!policyData) {
    return NextResponse.json(
      { success: false, error: "No policy found for this agent" },
      { status: 404 }
    );
  }

  const { policy, version } = policyData;
  const costs = AGENT_COSTS[identity.type];

  // Build sanitized summary (hide exact margins for competitive advantage)
  const summary = {
    agent_id: agentId,
    agent_name: identity.name,
    agent_type: identity.type,
    personality: policy.identity.personality,
    policy_version: version,

    // Bidding strategy (generalized, not exact numbers)
    bidding_strategy: describeBiddingStrategy(
      policy.bidding.target_margin,
      policy.bidding.min_margin
    ),

    // Partnership approach
    partnership_approach: {
      openness: describePartnershipOpenness(
        policy.partnerships.auto_accept.min_reputation,
        policy.partnerships.auto_accept.min_split
      ),
      target_types: policy.partnerships.propose.target_types,
      default_split: policy.partnerships.propose.default_split,
    },

    // QBR schedule
    qbr: {
      frequency_rounds: policy.qbr.base_frequency_rounds,
      accelerates_on_losses: policy.qbr.accelerate_if.losses_above,
    },

    // Exception sensitivity
    exception_sensitivity: describeExceptionSensitivity(
      policy.exceptions.consecutive_losses,
      policy.exceptions.balance_below
    ),

    // Cost structure (public info)
    cost_structure: {
      per_task_total: Object.values(costs.per_task).reduce(
        (a, b) => a + b,
        0
      ),
      per_bid: costs.per_bid.bid_submission,
      brain_wakeup: costs.periodic.brain_wakeup,
    },
  };

  return NextResponse.json({ success: true, data: summary });
}

/**
 * Describe bidding strategy without revealing exact margins
 */
function describeBiddingStrategy(
  targetMargin: number,
  _minMargin: number
): string {
  if (targetMargin >= 0.18) return "Premium pricing - targets high margins";
  if (targetMargin >= 0.12) return "Balanced - moderate margin targets";
  if (targetMargin >= 0.08)
    return "Competitive - accepts lower margins for volume";
  return "Aggressive - razor-thin margins to maximize wins";
}

/**
 * Describe partnership openness
 */
function describePartnershipOpenness(
  minReputation: number,
  _minSplit: number
): string {
  if (minReputation >= 700) return "Selective - partners with high-reputation agents only";
  if (minReputation >= 500) return "Moderate - standard partnership criteria";
  if (minReputation >= 400) return "Open - welcomes most partnerships";
  return "Very open - seeks partnerships aggressively";
}

/**
 * Describe exception sensitivity
 */
function describeExceptionSensitivity(
  consecutiveLosses: number,
  _balanceBelow: number
): string {
  if (consecutiveLosses <= 3)
    return "Highly vigilant - reacts quickly to problems";
  if (consecutiveLosses <= 5) return "Moderate - balanced monitoring";
  return "Relaxed - high tolerance for setbacks";
}
