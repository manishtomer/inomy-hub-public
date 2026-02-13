/**
 * Agent Brain Tools Index
 *
 * Central export of all tools available to the agent brain (Gemini LLM).
 * These tools enable strategic decision-making during QBR, exception handling,
 * and novel situation responses.
 *
 * Tools are categorized by cost and state modification:
 * - Query tools: Read-only, no cost (query_market, query_agent, get_my_stats, etc.)
 * - Analysis tools: Read-only, minimal cost (partnership_fit_analysis, policy_impact_analysis)
 * - Action tools: State-modifying, cost-bearing (update_policy, propose_partnership, etc.)
 *
 * Note: query_market now includes my_position (rank, market share, runway) when agent_id is injected.
 * The helper functions (getMyPosition, getMarketHealth, getFullMarketIntelligence) are available
 * for direct import but are not separate Gemini tools.
 */

import type { BrainToolContext } from "@/types/agent-system";
import { queryMarket, queryAgent } from "./market";
import { getMyStats, getQBRContext } from "./stats";
import { partnershipFitAnalysis, policyImpactAnalysis } from "./analysis";
import { updatePolicy, proposePartnership, createInvestorUpdate, getCurrentPartnerships, killPartnership } from "./actions";

/**
 * Complete brain tool context for agent decision-making
 * Provides unified interface to all tools
 */
export const brainToolContext: BrainToolContext = {
  // Query tools (read-only, no cost) - PHASE 1
  query_market: queryMarket,
  query_agent: queryAgent,
  get_my_stats: getMyStats,
  get_qbr_context: getQBRContext,
  get_current_partnerships: getCurrentPartnerships,

  // Analysis tools (read-only, minimal cost)
  partnership_fit_analysis: partnershipFitAnalysis,
  policy_impact_analysis: policyImpactAnalysis,

  // Action tools (modify state, cost-bearing) - PHASE 2
  update_policy: updatePolicy,
  propose_partnership: proposePartnership,
  kill_partnership: killPartnership,
  create_investor_update: createInvestorUpdate,
};

// Re-export all tools for direct import
export { queryMarket, queryAgent, getMyPosition, getMarketHealth, getFullMarketIntelligence } from "./market";
export type { MyPosition, MarketHealth, MarketIntelligence, QueryMarketInput, QueryMarketOutput, QueryAgentInput, QueryAgentOutput } from "./market";
export { getMyStats, getQBRContext } from "./stats";
export { partnershipFitAnalysis, policyImpactAnalysis } from "./analysis";
export { updatePolicy, proposePartnership, createInvestorUpdate, getCurrentPartnerships, killPartnership } from "./actions";
