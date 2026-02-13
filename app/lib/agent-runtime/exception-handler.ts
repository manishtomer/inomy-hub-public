/**
 * Exception Handler
 *
 * Detects anomalies that trigger brain wake-ups outside of scheduled QBRs.
 * Exceptions are conditions that violate policy thresholds and require
 * immediate strategic response.
 *
 * ## Agent ID Injection Pattern
 *
 * Like QBR handler, this handler also uses agent ID injection:
 *
 * 1. handleException(exception) receives exception.agent_id
 * 2. Builds exception context (agent stats via brainToolContext.get_my_stats)
 * 3. Calls brainExceptionResponse(agent_id, prompt) with agent_id separate
 * 4. brainExceptionResponse passes agent_id to executeToolCalls(toolCalls, agent_id)
 * 5. Tools like get_my_stats receive injected agent_id
 *
 * ## Exception Types
 * - Consecutive Losses: N losses in a row
 * - Low Balance: Balance below threshold
 * - Reputation Drop: Reputation drops X points
 * - Win Rate Drop: Win rate drops X percent
 * - Unknown Situation: Anomaly that doesn't fit other categories
 *
 * ## Response Pattern
 *
 * When exception detected:
 * 1. Check agent runtime state and policy
 * 2. Call Gemini with exception context
 * 3. Gemini may call tools to gather additional info
 * 4. Tools execute with injected agent_id
 * 5. Gemini recommends policy changes or other actions
 * 6. Changes executed via update_policy tool
 * 7. Investor update created for transparency
 *
 * See TOOL_INTEGRATION_GUIDE.md for detailed patterns.
 */

import { supabase } from "@/lib/supabase";
import { brainToolContext } from "@/lib/agent-tools";
import type {
  ExceptionType,
  UpdatePolicyInput,
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

export interface Exception {
  agent_id: string;
  type: ExceptionType;
  details: string;
  current_value: number;
  threshold: number;
}

/**
 * Check agent for exceptions based on current runtime state
 */
export async function checkForExceptions(agent_id: string): Promise<Exception[]> {
  const exceptions: Exception[] = [];

  // Get agent state
  const { data: agent } = await supabase
    .from("agents")
    .select("*")
    .eq("id", agent_id)
    .single();

  if (!agent) return [];

  // Get agent policy (latest one)
  const { data: policyData } = await supabase
    .from("agent_policies")
    .select("policy_json")
    .eq("agent_id", agent_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!policyData?.policy_json) return [];

  const policy = policyData.policy_json;

  // Get recent bid data
  const { data: recentBids } = await supabase
    .from("bids_cache")
    .select("*")
    .eq("bidder_wallet", agent.wallet_address)
    .order("created_at", { ascending: false })
    .limit(50);

  const bids = recentBids || [];

  // Check consecutive losses
  let consecutiveLosses = 0;
  for (const bid of bids) {
    if (bid.status === "WON") break;
    consecutiveLosses++;
  }

  if (
    consecutiveLosses >= (policy.exceptions?.consecutive_losses || 5)
  ) {
    exceptions.push({
      agent_id,
      type: "consecutive_losses",
      details: `${consecutiveLosses} consecutive auction losses`,
      current_value: consecutiveLosses,
      threshold: policy.exceptions?.consecutive_losses || 5,
    });
  }

  // Check balance threshold
  const balanceThreshold = (policy.exceptions?.balance_below || 0.2);
  if (agent.balance < balanceThreshold) {
    exceptions.push({
      agent_id,
      type: "low_balance",
      details: `Balance ${agent.balance} below threshold ${balanceThreshold}`,
      current_value: agent.balance,
      threshold: balanceThreshold,
    });
  }

  // Check reputation drops (would need historical data)
  // Simplified: compare to baseline (would need historical tracking)
  if (agent.reputation < 2.5) {
    exceptions.push({
      agent_id,
      type: "reputation_drop",
      details: `Reputation ${agent.reputation} critically low`,
      current_value: agent.reputation,
      threshold: 2.5,
    });
  }

  // Check win rate drops
  const winRate = bids.length > 0 ? bids.filter((b) => b.status === "WON").length / bids.length : 0;
  const winRateDropThreshold = (policy.exceptions?.win_rate_drop_percent || 20) / 100;
  if (winRate < winRateDropThreshold) {
    exceptions.push({
      agent_id,
      type: "win_rate_drop",
      details: `Win rate ${(winRate * 100).toFixed(1)}% below threshold ${(winRateDropThreshold * 100).toFixed(1)}%`,
      current_value: winRate,
      threshold: winRateDropThreshold,
    });
  }

  return exceptions;
}

/**
 * Handle an exception using autonomous strategic thinking
 * The agent receives context about the emergency and decides how to respond
 */
export async function handleException(exception: Exception): Promise<void> {
  const { agent_id, type, details, current_value, threshold } = exception;

  try {
    logger.info(`[EXCEPTION] ${type} for agent ${agent_id}: ${details}`);

    // Record exception in history
    const { data: exceptionRecord } = await supabase
      .from("exception_history")
      .insert([
        {
          agent_id,
          exception_type: type,
          exception_details: details,
          current_value,
          threshold,
          brain_response: {},
          resolved: false,
        },
      ])
      .select()
      .single();

    // Build unified wake-up context using context builder
    const urgency = determineExceptionUrgency(exception);
    const context = await buildWakeUpContext(
      agent_id,
      'exception',
      details,
      urgency
    );

    logger.info(`[EXCEPTION] Context built. Balance: ${context.identity.balance.toFixed(3)}, Reputation: ${context.identity.reputation}`);

    // Build strategic thinking prompts (open-ended, not prescriptive)
    const systemPrompt = buildStrategicSystemPrompt(context);
    const userPrompt = buildStrategicUserPrompt(context);
    const historySummary = buildHistorySummary(context);

    // Try autonomous strategic thinking, fall back to simulation if not available
    let brainResponse;
    try {
      const { brainStrategicThinking } = await import("@/lib/agent-brain/gemini-integration");
      const result = await brainStrategicThinking(agent_id, systemPrompt, userPrompt, historySummary, 'exception');

      logger.info(`[EXCEPTION] Autonomous response complete. Actions: ${result.actions_taken.length}`);

      // Convert to legacy format for backward compatibility
      brainResponse = {
        reasoning: result.reasoning,
        observations: result.actions_taken.map(a => a.description),
        policy_changes: result.policy_changes,
        changes: result.actions_taken
          .filter(a => a.tool === "update_policy" || a.tool === "propose_partnership")
          .map(a => ({
            category: a.tool === "update_policy" ? "policy" : "partnership",
            description: a.description,
            reasoning: "Agent autonomous decision in response to exception",
          })),
        survival_impact: "Agent assessed and responded to exception",
        growth_impact: "Focused on survival first",
      };
    } catch (error) {
      logger.warn(`[EXCEPTION] Autonomous thinking not available, using simulation:`, error);
      brainResponse = simulateBrainExceptionResponse(exception, context);
    }

    logger.info(`[EXCEPTION] Brain response: ${JSON.stringify(brainResponse).substring(0, 500)}...`);

    // Execute brain recommendations

    // 1. Apply policy changes
    if (brainResponse.policy_changes && Object.keys(brainResponse.policy_changes).length > 0) {
      logger.info(`[EXCEPTION] Updating policy in response to ${type}...`);

      const updatePolicyInput: UpdatePolicyInput = {
        agent_id,
        policy_updates: brainResponse.policy_changes,
        reasoning: brainResponse.reasoning,
        trigger_type: "exception",
        trigger_details: details,
      };

      const policyResult = await brainToolContext.update_policy(updatePolicyInput);
      logger.info(`[EXCEPTION] Policy updated: version ${policyResult.version}`);
    }

    // 2. Create investor update
    logger.info(`[EXCEPTION] Creating investor transparency update...`);

    const investorUpdateInput: CreateInvestorUpdateInput = {
      agent_id,
      trigger_type: "exception",
      observations: brainResponse.observations,
      changes: brainResponse.changes,
      survival_impact: brainResponse.survival_impact,
      growth_impact: brainResponse.growth_impact,
      brain_cost: 0.01,
    };

    const investorUpdateResult = await brainToolContext.create_investor_update(investorUpdateInput);
    logger.info(`[EXCEPTION] Investor update created: ${investorUpdateResult.update_id}`);

    // 3. Update exception record with brain response
    if (exceptionRecord) {
      await supabase
        .from("exception_history")
        .update({
          brain_response: brainResponse,
        })
        .eq("id", exceptionRecord.id);
    }

    logger.info(`[EXCEPTION] Exception handling complete for agent ${agent_id}`);
  } catch (error) {
    logger.error(`[EXCEPTION] Failed to handle exception for agent ${agent_id}:`, error);
    throw error;
  }
}

/**
 * Determine urgency level for an exception
 */
function determineExceptionUrgency(exception: Exception): 'low' | 'medium' | 'high' | 'critical' {
  switch (exception.type) {
    case 'low_balance':
      // Critical if balance is very low
      return exception.current_value < 0.1 ? 'critical' : 'high';

    case 'consecutive_losses':
      // High urgency if many consecutive losses
      return exception.current_value >= 10 ? 'critical' : exception.current_value >= 7 ? 'high' : 'medium';

    case 'reputation_drop':
      // High urgency if reputation is critically low
      return exception.current_value < 2.0 ? 'critical' : 'high';

    case 'win_rate_drop':
      // Medium urgency for win rate drops
      return exception.current_value < 0.1 ? 'high' : 'medium';

    default:
      return 'medium';
  }
}

/**
 * Build prompt for brain to respond to exception
 * DEPRECATED: Now using unified context builder
 *
 * Left here for reference, but no longer used.
 * See buildWakeUpContext() in context-builder.ts instead.
 */
/*
function buildExceptionPrompt(stats: any, exception: Exception): string {
  return `
EXCEPTION ALERT: ${exception.type}

Current Situation:
- Balance: ${stats.current_balance}
- Reputation: ${stats.reputation}
- Win Rate: ${(stats.win_rate * 100).toFixed(1)}%
- Consecutive Losses: ${stats.consecutive_losses_current}
- Runway: ${Math.ceil(stats.runway_estimated_rounds)} rounds

Exception Details:
- Type: ${exception.type}
- Current Value: ${exception.current_value}
- Threshold: ${exception.threshold}

IMMEDIATE RESPONSE NEEDED:
What policy adjustments should I make to address this exception?
Should I seek partnerships? Reduce risk? Adjust margins?

Provide: policy_changes, reasoning, survival_impact, growth_impact
`;
}
*/

/**
 * Simulate brain response to exception (placeholder for Claude LLM)
 */
function simulateBrainExceptionResponse(exception: Exception, _context: any) {
  const response: any = {
    observations: [
      `Exception triggered: ${exception.type}`,
      `Current value: ${exception.current_value}, Threshold: ${exception.threshold}`,
    ],
    policy_changes: {},
    changes: [],
    reasoning: `Responding to ${exception.type} exception`,
    survival_impact: "Taking corrective action",
    growth_impact: "Pausing growth initiatives to ensure survival",
  };

  // Simulate different responses based on exception type
  switch (exception.type) {
    case "consecutive_losses":
      // Reduce bidding aggressiveness
      response.policy_changes = {
        bidding: {
          target_margin: 0.20, // More conservative
          skip_below: 0.10,
        },
      };
      response.changes.push({
        category: "bidding",
        description: "Increased target margin to reduce risk",
        reasoning: "Consecutive losses indicate bidding strategy too aggressive",
      });
      break;

    case "low_balance":
      // Become very conservative
      response.policy_changes = {
        bidding: {
          target_margin: 0.25, // Very conservative
          skip_below: 0.20,
        },
      };
      response.changes.push({
        category: "strategy",
        description: "Emergency conservative mode activated",
        reasoning: "Balance critically low - must preserve capital",
      });
      response.survival_impact = "Focused on capital preservation";
      break;

    case "reputation_drop":
      // May need partnerships to rebuild
      response.changes.push({
        category: "partnership",
        description: "Seeking high-reputation partners",
        reasoning: "Partnership with strong reputation agents helps rebuild trust",
      });
      break;

    case "win_rate_drop":
      // Adjust margins and analysis
      response.policy_changes = {
        bidding: {
          target_margin: 0.15, // Moderate adjustment
        },
      };
      response.changes.push({
        category: "bidding",
        description: "Adjusted margins for better competitiveness",
        reasoning: "Low win rate suggests margin needs adjustment",
      });
      break;

    default:
      response.reasoning = `Emergency response to ${exception.type}`;
  }

  return response;
}
