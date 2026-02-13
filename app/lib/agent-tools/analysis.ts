/**
 * Strategic Analysis Tools
 *
 * Provides agents with decision-support analysis for partnerships and policy impacts.
 * These tools help the brain (Claude LLM) evaluate options before making commitments.
 *
 * Tools in this module:
 * - partnership_fit_analysis: Evaluate compatibility between two agents
 * - policy_impact_analysis: Predict outcomes of policy changes
 */

import { supabase } from "@/lib/supabase";
import type {
  PartnershipFitAnalysisInput,
  PartnershipFitAnalysisOutput,
  PolicyImpactAnalysisInput,
  PolicyImpactAnalysisOutput,
} from "@/types/agent-system";

/**
 * Analyze fit and compatibility between two agents for partnership
 * Evaluates skill match, reputation alignment, economics, and culture
 *
 * @param input - Two agent IDs and optional proposed split
 * @returns Comprehensive partnership analysis with recommendation
 */
export async function partnershipFitAnalysis(input: PartnershipFitAnalysisInput): Promise<PartnershipFitAnalysisOutput> {
  const { agent_a_id, agent_b_id, proposed_split_a } = input;

  // Helper function to fetch agent by ID or name
  const fetchAgent = async (agentIdentifier: string) => {
    // First try as UUID
    const { data: agentByID } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentIdentifier)
      .single();

    if (agentByID) {
      return agentByID;
    }

    // If not found by ID, try by name
    const { data: agentByName } = await supabase
      .from("agents")
      .select("*")
      .eq("name", agentIdentifier)
      .single();

    if (agentByName) {
      return agentByName;
    }

    return null;
  };

  // Fetch both agents
  const agentA = await fetchAgent(agent_a_id);
  const agentB = await fetchAgent(agent_b_id);

  if (!agentA || !agentB) {
    throw new Error(`Failed to fetch agents for partnership analysis`);
  }

  // Calculate skill complementarity (based on type diversity)
  const skill_complementarity =
    agentA.type !== agentB.type ? 0.9 : 0.5; // Different types more complementary

  // Calculate reputation fit (similarity is good)
  const repDiff = Math.abs(agentA.reputation - agentB.reputation) / Math.max(agentA.reputation, agentB.reputation);
  const reputation_fit = Math.max(0, 1 - repDiff);

  // Calculate economic fit (balance compatibility)
  const economicRatio = Math.min(agentA.balance, agentB.balance) / Math.max(agentA.balance, agentB.balance, 1);
  const economic_fit = economicRatio > 0.5 ? 0.9 : economicRatio > 0.2 ? 0.6 : 0.3;

  // Cultural fit (personality compatibility - simplified)
  const cultural_fit = 0.75; // Placeholder for personality analysis

  // Overall fit score
  const fit_score =
    skill_complementarity * 0.25 + reputation_fit * 0.25 + economic_fit * 0.25 + cultural_fit * 0.25;

  // Estimated synergies
  const synergies = [];
  if (skill_complementarity > 0.7) {
    synergies.push("Strong skill complementarity will improve bid success rate");
  }
  if (reputation_fit > 0.7) {
    synergies.push("Reputation alignment suggests compatible market positioning");
  }
  if (economic_fit > 0.7) {
    synergies.push("Similar financial scales allow balanced partnership");
  }

  // Risks
  const risks = [];
  if (repDiff > 0.4) {
    risks.push("Large reputation gap may cause tension in decision-making");
  }
  if (economic_fit < 0.5) {
    risks.push("Unbalanced financial resources may affect partnership stability");
  }

  // Get historical win rates
  const { data: bidsA } = await supabase
    .from("bids_cache")
    .select("*")
    .eq("bidder_wallet", agentA.wallet_address)
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: bidsB } = await supabase
    .from("bids_cache")
    .select("*")
    .eq("bidder_wallet", agentB.wallet_address)
    .order("created_at", { ascending: false })
    .limit(50);

  const winRateA = bidsA && bidsA.length > 0 ? bidsA.filter((b) => b.status === "WON").length / bidsA.length : 0.5;
  const winRateB = bidsB && bidsB.length > 0 ? bidsB.filter((b) => b.status === "WON").length / bidsB.length : 0.5;

  // Estimate joint win rate (multiplicative synergy)
  const estimated_joint_win_rate = Math.min(1, (winRateA + winRateB) / 1.5); // Simplified

  // Estimate margin improvement
  const baselineMargin = (agentA.balance + agentB.balance) / (Math.max(100, (agentA.balance + agentB.balance) * 10));
  const estimated_margin_improvement = baselineMargin * 0.2; // 20% improvement estimate

  // Recommendation based on fit score
  let recommendation: PartnershipFitAnalysisOutput["recommendation"];
  if (fit_score > 0.75) {
    recommendation = "highly_recommended";
  } else if (fit_score > 0.5) {
    recommendation = "worth_exploring";
  } else {
    recommendation = "not_recommended";
  }

  // Suggest split
  const suggested_split_a = proposed_split_a || 0.5;
  const suggested_split_b = 1 - suggested_split_a;

  // Alternative terms
  const alternative_terms = [
    {
      split_a: 0.4,
      split_b: 0.6,
      pros: ["Better margin protection for agent B"],
      cons: ["Reduced revenue share for agent A"],
    },
    {
      split_a: 0.6,
      split_b: 0.4,
      pros: ["Better margin for agent A", "Stronger negotiating position"],
      cons: ["Less attractive for agent B"],
    },
  ];

  return {
    fit_score,
    skill_complementarity,
    reputation_fit,
    economic_fit,
    cultural_fit,
    reasoning: `Partnership analysis between ${agentA.name} and ${agentB.name}. Fit score: ${(fit_score * 100).toFixed(1)}%. Recommendation: ${recommendation}.`,
    synergies,
    risks,
    estimated_joint_win_rate,
    estimated_margin_improvement,
    recommendation,
    suggested_split_a,
    suggested_split_b,
    alternative_terms,
  };
}

/**
 * Analyze potential impact of proposed policy changes
 * Provides best-case, worst-case, and expected outcomes
 *
 * @param input - Agent ID and proposed policy changes
 * @returns Impact analysis with risk assessment and recommendation
 */
export async function policyImpactAnalysis(input: PolicyImpactAnalysisInput): Promise<PolicyImpactAnalysisOutput> {
  const { agent_id, proposed_policy_changes } = input;

  // Fetch current agent state - try by ID first, then by name
  let agent = null;
  let agentError = null;

  // First try as UUID
  const { data: agentByID, error: errorByID } = await supabase
    .from("agents")
    .select("*")
    .eq("id", agent_id)
    .single();

  if (agentByID) {
    agent = agentByID;
  } else {
    // If not found by ID, try by name
    const { data: agentByName, error: errorByName } = await supabase
      .from("agents")
      .select("*")
      .eq("name", agent_id)
      .single();

    if (agentByName) {
      agent = agentByName;
    } else {
      agentError = errorByID || errorByName;
    }
  }

  if (agentError || !agent) {
    throw new Error(`Failed to fetch agent: ${agentError?.message}`);
  }

  // Get current policy (latest one)
  const { data: policyData } = await supabase
    .from("agent_policies")
    .select("policy_json")
    .eq("agent_id", agent.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Get recent performance
  const { data: recentBids } = await supabase
    .from("bids_cache")
    .select("*")
    .eq("bidder_wallet", agent.wallet_address)
    .order("created_at", { ascending: false })
    .limit(50);

  const bids = recentBids || [];
  const currentWinRate = bids.length > 0 ? bids.filter((b) => b.status === "WON").length / bids.length : 0.5;

  // Analyze policy changes impact
  let expected_win_rate_change = 0;
  let expected_margin_change = 0;
  let expected_runway_change = 0;

  // Check if adjusting bidding margins
  if (proposed_policy_changes.bidding?.target_margin) {
    const marginDiff = proposed_policy_changes.bidding.target_margin - (policyData?.policy_json?.bidding?.target_margin || 0.15);
    // More aggressive (lower margin) = higher win rate but lower margins
    expected_win_rate_change = marginDiff < 0 ? 0.1 : -0.05;
    expected_margin_change = marginDiff * 100; // in basis points
    expected_runway_change = marginDiff < 0 ? 10 : -10; // More aggressive increases runway usage
  }

  // Check partnership changes
  if (proposed_policy_changes.partnerships?.auto_accept?.min_reputation) {
    const repThresholdChange = proposed_policy_changes.partnerships.auto_accept.min_reputation;
    expected_win_rate_change += repThresholdChange < 3 ? 0.05 : -0.05;
  }

  // Worst case scenario (conservative)
  const worst_case_win_rate = Math.max(0, currentWinRate + expected_win_rate_change - 0.1);
  const worst_case_runway = Math.max(1, agent.balance - Math.abs(expected_runway_change) * 2);
  const worst_case_scenario = `Stricter criteria adopted. Win rate drops to ${(worst_case_win_rate * 100).toFixed(1)}%. Runway reduced to ${worst_case_runway.toFixed(0)} units.`;

  // Best case scenario (optimistic)
  const best_case_win_rate = Math.min(1, currentWinRate + expected_win_rate_change + 0.15);
  const best_case_runway = agent.balance + Math.abs(expected_runway_change) * 0.5;
  const best_case_scenario = `Market conditions align with new policy. Win rate improves to ${(best_case_win_rate * 100).toFixed(1)}%. Runway extends to ${best_case_runway.toFixed(0)} units.`;

  // Risk level assessment
  let risk_level: PolicyImpactAnalysisOutput["risk_level"];
  if (Math.abs(expected_runway_change) > 50 || expected_win_rate_change < -0.2) {
    risk_level = "high";
  } else if (Math.abs(expected_runway_change) > 20 || expected_win_rate_change < -0.1) {
    risk_level = "medium";
  } else {
    risk_level = "low";
  }

  // Recommendation
  let recommendation: PolicyImpactAnalysisOutput["recommendation"];
  if (risk_level === "high") {
    recommendation = "not_recommended";
  } else if (expected_win_rate_change > 0.05 || expected_runway_change > 0) {
    recommendation = "proceed";
  } else {
    recommendation = "consider_alternatives";
  }

  const impact_summary =
    `Policy changes show ${risk_level} risk. Expected win rate change: ${(expected_win_rate_change * 100).toFixed(1)}%. ` +
    `Margin impact: ${expected_margin_change.toFixed(1)} bps. Runway impact: ${expected_runway_change.toFixed(0)} units.`;

  return {
    expected_win_rate_change,
    expected_margin_change,
    expected_runway_change,
    worst_case_scenario,
    worst_case_win_rate,
    worst_case_runway,
    best_case_scenario,
    best_case_win_rate,
    best_case_runway,
    impact_summary,
    risk_level,
    recommendation,
  };
}
