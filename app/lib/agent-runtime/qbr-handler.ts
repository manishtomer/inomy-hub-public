/**
 * Quarterly Business Review (QBR) Handler
 *
 * Orchestrates strategic reviews when agents need to evaluate performance,
 * adjust policies, and make partnership decisions.
 *
 * ## Agent ID Injection Pattern
 *
 * This handler demonstrates the agent ID injection pattern:
 *
 * 1. executeQBR(trigger) receives agent_id from trigger.agent_id
 * 2. Builds QBR context with agent info but NO explicit agent_id in prompt
 * 3. Calls brainQBRDecision(agent_id, prompt) with agent_id separate from prompt
 * 4. brainQBRDecision passes agent_id to executeToolCalls(toolCalls, agent_id)
 * 5. Each tool execution injects the correct agent_id at execution time
 *
 * This ensures all tools operate on the correct agent regardless of Gemini's inference.
 *
 * ## Tool Execution Flow
 *
 * Phase 1: Data Gathering
 * - Gemini analyzes prompt and market context
 * - Calls tools: query_market, get_my_stats, get_qbr_context
 * - executeToolCalls injects agent_id for stats and context tools
 * - Results returned to Gemini
 *
 * Phase 2: Decision Making
 * - Gemini synthesizes results and generates decisions
 * - Returns structured output with policy changes and partnerships
 *
 * Phase 3: Execution
 * - Policy updates applied via update_policy tool
 * - Partnerships proposed via propose_partnership tool
 * - Investor update created for transparency
 * - QBR history recorded
 *
 * Triggered by:
 * - Scheduled QBR rounds (every N rounds per policy)
 * - Market volatility (accelerates review frequency)
 * - Performance changes (triggers early review)
 *
 * See TOOL_INTEGRATION_GUIDE.md for detailed patterns.
 */

import { supabase } from "@/lib/supabase";
import { brainToolContext } from "@/lib/agent-tools";
import type {
  GetQBRContextOutput,
  CreateInvestorUpdateInput,
} from "@/types/agent-system";
import { createRuntimeLogger } from "./logger";
import { buildWakeUpContext } from "./context-builder";
import {
  buildStrategicSystemPrompt,
  buildStrategicUserPrompt,
  buildHistorySummary,
} from "./prompts/strategic-thinking";

const logger = createRuntimeLogger("info");

interface QBRTrigger {
  agent_id: string;
  trigger_reason: "scheduled" | "accelerated" | "volatility" | "degradation" | "manual";
  current_round: number;
}

/**
 * Check if QBR should be triggered for an agent
 */
export async function shouldTriggerQBR(
  agentId: string,
  currentRound: number
): Promise<QBRTrigger | null> {
  // Fetch agent policy (latest one)
  const { data: policyData } = await supabase
    .from("agent_policies")
    .select("policy_json, last_qbr_round")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!policyData?.policy_json) {
    return null;
  }

  const policy = policyData.policy_json;
  const lastQBRRound = policyData.last_qbr_round || 0;
  const roundsSinceLast = currentRound - lastQBRRound;

  // Check if scheduled QBR is due
  const baseFrequency = policy.qbr?.base_frequency_rounds || 10;
  if (roundsSinceLast >= baseFrequency) {
    return {
      agent_id: agentId,
      trigger_reason: "scheduled",
      current_round: currentRound,
    };
  }

  // Check for acceleration triggers
  if (
    policy.qbr?.accelerate_if?.volatility_above &&
    roundsSinceLast >= baseFrequency * 0.5
  ) {
    return {
      agent_id: agentId,
      trigger_reason: "accelerated",
      current_round: currentRound,
    };
  }

  return null;
}

/**
 * Execute QBR for an agent using autonomous strategic thinking
 * The agent receives context and tools, then decides what to do on its own
 */
export async function executeQBR(trigger: QBRTrigger): Promise<void> {
  const { agent_id, trigger_reason, current_round } = trigger;

  try {
    logger.info(`[QBR] Starting autonomous QBR for agent ${agent_id} (reason: ${trigger_reason})`);

    // Build unified wake-up context using context builder
    const context = await buildWakeUpContext(
      agent_id,
      'qbr',
      `QBR triggered by ${trigger_reason}`,
      'medium'
    );

    logger.info(`[QBR] Context built. Win rate: ${(context.state.win_rate_last_20 * 100).toFixed(1)}%, Balance: ${context.identity.balance.toFixed(3)}`);

    // Build strategic thinking prompts (open-ended, not prescriptive)
    const systemPrompt = buildStrategicSystemPrompt(context);
    const userPrompt = buildStrategicUserPrompt(context);
    const historySummary = buildHistorySummary(context);

    // Also get legacy QBR context for backward compatibility (used in history recording)
    const qbrContext: GetQBRContextOutput = await brainToolContext.get_qbr_context({
      agent_id,
      include_partnership_recommendations: true,
    });

    // Try autonomous strategic thinking, fall back to simulation if not available
    let brainDecisions;
    try {
      const { brainStrategicThinking } = await import("@/lib/agent-brain/gemini-integration");
      const result = await brainStrategicThinking(agent_id, systemPrompt, userPrompt, historySummary, 'qbr');

      logger.info(`[QBR] Two-phase thinking complete`);
      logger.info(`[QBR] Phase 1: Gathered data on market, partners, performance`);
      logger.info(`[QBR] Phase 2: Took ${result.phase2_actions?.length || 0} actions`);

      // Log Phase 2 actions with reasoning
      if (result.phase2_actions) {
        for (const action of result.phase2_actions) {
          logger.info(`[QBR] ${action.tool}: ${action.reasoning}`);
        }
      }

      // Convert to legacy format for backward compatibility
      brainDecisions = {
        reasoning: result.reasoning,
        policy_changes: result.policy_changes,
        partnership_actions: result.partnership_actions,
        investor_update: {
          trigger_type: "qbr",
          trigger_details: `QBR triggered by ${trigger_reason}`,
          observations: result.investor_update?.observations || [],
          changes: result.investor_update?.changes || [],
          survival_impact: "Assessed by agent",
          growth_impact: "Assessed by agent",
          brain_cost: 0.02,
        },
      };
    } catch (error) {
      logger.warn(`[QBR] Autonomous thinking not available, using simulation:`, error);
      brainDecisions = simulateBrainQBRDecisions(qbrContext);
    }

    logger.info(`[QBR] Brain decisions summary: Actions: ${brainDecisions.partnership_actions?.length || 0}, Policy changes: ${Object.keys(brainDecisions.policy_changes || {}).length > 0}`);

    // Policy changes are already applied during Phase 2 tool execution
    // (brainStrategicThinking calls update_policy directly via Gemini tool calls).
    // We only log here for visibility.
    if (brainDecisions.policy_changes && Object.keys(brainDecisions.policy_changes).length > 0) {
      logger.info(`[QBR] Policy changes applied during Phase 2: ${JSON.stringify(brainDecisions.policy_changes)}`);
    }

    // Execute partnership actions (belt-and-suspenders: Phase 2 already handles via Gemini tool calls)
    if (brainDecisions.partnership_actions && brainDecisions.partnership_actions.length > 0) {
      logger.info(`[QBR] Executing partnership actions...`);

      for (const action of brainDecisions.partnership_actions) {
        if (action.action === "seek" && (action.target_agent_name || action.target_agent_id)) {
          try {
            const partnershipInput = {
              agent_id,
              target_agent_name: action.target_agent_name || action.target_agent_id,
              proposed_split_self: action.proposed_split || 0.5,
              proposed_split_partner: 1 - (action.proposed_split || 0.5),
              reasoning: action.reasoning || `Partnership proposal from QBR analysis`,
            };

            const partnershipResult = await brainToolContext.propose_partnership(partnershipInput);
            logger.info(`[QBR] Partnership proposed: ${partnershipResult.partnership_id}`);
          } catch (err) {
            logger.warn(`[QBR] Partnership proposal failed for ${agent_id}: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
    }

    // Create investor update from Gemini's structured output
    logger.info(`[QBR] Creating investor update from structured output...`);

    // Extract investor update from brain decisions (now structured by Gemini)
    const investorUpdateData = brainDecisions.investor_update || {
      trigger_type: "qbr",
      trigger_details: `QBR triggered by ${trigger_reason}`,
      observations: [],
      changes: [],
      survival_impact: "Stable",
      growth_impact: "Maintained",
      brain_cost: 0.01
    };

    const investorUpdateInput: CreateInvestorUpdateInput = {
      agent_id,
      trigger_type: "qbr",  // Always "qbr" for QBR handler
      observations: investorUpdateData.observations,
      changes: investorUpdateData.changes as unknown as Array<{
        category: "policy" | "partnership" | "bidding" | "strategy" | "philosophy";
        description: string;
        reasoning: string;
      }>,
      survival_impact: investorUpdateData.survival_impact,
      growth_impact: investorUpdateData.growth_impact,
      brain_cost: investorUpdateData.brain_cost,
    };

    const investorUpdateResult = await brainToolContext.create_investor_update(investorUpdateInput);
    logger.info(`[QBR] Investor update created: ${investorUpdateResult.update_id}`);

    // Record QBR in history with complete structured output
    const qbrHistoryRecord = {
      agent_id,
      qbr_number: (qbrContext.qbr_number || 1),
      period: {
        rounds_since_last: qbrContext.rounds_since_last_qbr,
        start_round: current_round - qbrContext.rounds_since_last_qbr,
        end_round: current_round,
      },
      input_metrics: {
        win_rate_start: qbrContext.win_rate_start,
        win_rate_end: qbrContext.win_rate_end,
        balance_start: qbrContext.balance_start_period,
        balance_end: qbrContext.balance_end_period,
        reputation_start: qbrContext.reputation_start,
        reputation_end: qbrContext.reputation_end,
      },
      // Include all decision details in the decisions JSONB
      decisions: {
        policy_changes: brainDecisions.policy_changes || {},
        partnership_actions: brainDecisions.partnership_actions || [],
        reasoning: brainDecisions.reasoning || "No analysis provided",
        investor_update: brainDecisions.investor_update || {
          trigger_type: "qbr",
          trigger_details: "Periodic QBR review",
          observations: [],
          changes: [],
          survival_impact: "Stable",
          growth_impact: "Maintained",
          brain_cost: 0.01,
        },
      },
      outcome: {
        actual_win_rate: qbrContext.win_rate_end,
        actual_balance_change: qbrContext.balance_end_period - qbrContext.balance_start_period,
        success: true,
      },
    };

    logger.info(`[QBR] Recording QBR history with complete decisions data`);
    logger.info(`[QBR] ===== QBR HISTORY RECORD =====`);
    logger.info(`[QBR] QBR Number: ${qbrHistoryRecord.qbr_number}`);
    logger.info(`[QBR] Period: ${JSON.stringify(qbrHistoryRecord.period)}`);
    logger.info(`[QBR] Policy Changes: ${JSON.stringify(qbrHistoryRecord.decisions.policy_changes)}`);
    logger.info(`[QBR] Partnership Actions: ${JSON.stringify(qbrHistoryRecord.decisions.partnership_actions)}`);
    logger.info(`[QBR] Reasoning: ${qbrHistoryRecord.decisions.reasoning}`);
    logger.info(`[QBR] Investor Update Observations: ${JSON.stringify(qbrHistoryRecord.decisions.investor_update?.observations)}`);
    logger.info(`[QBR] Investor Update Changes: ${JSON.stringify(qbrHistoryRecord.decisions.investor_update?.changes)}`);
    logger.info(`[QBR] Survival Impact: ${qbrHistoryRecord.decisions.investor_update?.survival_impact}`);
    logger.info(`[QBR] Growth Impact: ${qbrHistoryRecord.decisions.investor_update?.growth_impact}`);
    logger.info(`[QBR] ===== END QBR HISTORY RECORD =====`);

    await supabase.from("qbr_history").insert([qbrHistoryRecord]);

    // Update last_qbr_round so QBR doesn't trigger again until next interval
    const { error: updateError } = await supabase
      .from("agent_policies")
      .update({ last_qbr_round: current_round })
      .eq("agent_id", agent_id);

    if (updateError) {
      logger.error(`[QBR] Failed to update last_qbr_round: ${updateError.message}`);
    } else {
      logger.info(`[QBR] Updated last_qbr_round to ${current_round}`);
    }

    logger.info(`[QBR] QBR completed successfully for agent ${agent_id}`);
  } catch (error) {
    logger.error(`[QBR] QBR execution failed for agent ${agent_id}:`, error);
    throw error;
  }
}


/**
 * Simulate brain decisions (fallback when Gemini not available)
 * Returns structure matching new brainQBRDecision output format
 */
function simulateBrainQBRDecisions(qbrContext: GetQBRContextOutput) {
  const observations = [
    `Win rate changed by ${(qbrContext.win_rate_change * 100).toFixed(1)}%`,
    `Balance trend: ${qbrContext.balance_trend}`,
    `Market position: ${qbrContext.market_position}`,
  ];

  const changes: Array<{ category: string; description: string; reasoning: string }> = [];
  const policyChanges: any = {};
  const partnershipActions: any[] = [];
  let survivalImpact = "Stable";
  let growthImpact = "Analyzing market opportunity";

  // Simulate decisions based on context
  if (qbrContext.win_rate_change < -0.1) {
    // Win rate declining - might need more aggressive bidding
    policyChanges.bidding = {
      target_margin: 0.12, // More aggressive
    };
    changes.push({
      category: "bidding",
      description: "Reduced target margin to improve win rate",
      reasoning: "Win rate declining - need more competitive positioning",
    });
    survivalImpact = "Improved bid competitiveness should increase win rate";
  }

  if (
    qbrContext.market_position === "struggling" &&
    qbrContext.potential_partners &&
    qbrContext.potential_partners.length > 0
  ) {
    // Struggling - suggest partnerships
    partnershipActions.push({
      action: "seek",
      target_agent_id: qbrContext.potential_partners[0]?.partner_id,
      proposed_split: 0.5,
      reasoning: "Partnership with strong agent to improve market position",
    });
    changes.push({
      category: "partnership",
      description: "Seeking strategic partnership",
      reasoning: "Current position warrants partnership to improve competitiveness",
    });
  }

  return {
    reasoning: "Simulation-based QBR analysis (Gemini not available)",
    policy_changes: policyChanges,
    partnership_actions: partnershipActions,
    investor_update: {
      trigger_type: "qbr",
      trigger_details: "Simulated QBR review (Gemini fallback)",
      observations,
      changes,
      survival_impact: survivalImpact,
      growth_impact: growthImpact,
      brain_cost: 0.01,
    },
  };
}
