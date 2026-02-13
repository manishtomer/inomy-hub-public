/**
 * Universal Tool Executor
 *
 * Handles tool execution for both Gemini and other AI providers.
 * Provides common interface for tool execution and result handling.
 */

import { brainToolContext } from "@/lib/agent-tools";
import { TOOL_NAMES } from "@/lib/agent-tools/schemas";
import { createRuntimeLogger } from "@/lib/agent-runtime/logger";

const logger = createRuntimeLogger("info");

/**
 * Tool execution request
 */
export interface ToolRequest {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Tool execution response
 */
export interface ToolResponse {
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
  costDeducted?: number;
}

/**
 * Execute a single tool by name with arguments
 */
export async function executeSingleTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  logger.info(`[EXECUTOR] Executing tool: ${toolName}`, args);

  try {
    let result: unknown;
    let costDeducted = 0;

    // Route to tool based on name
    switch (toolName) {
      case TOOL_NAMES.QUERY_MARKET:
        result = await brainToolContext.query_market(
          args as unknown as Parameters<typeof brainToolContext.query_market>[0]
        );
        break;

      case TOOL_NAMES.QUERY_AGENT:
        result = await brainToolContext.query_agent(
          args as unknown as Parameters<typeof brainToolContext.query_agent>[0]
        );
        break;

      case TOOL_NAMES.GET_MY_STATS:
        result = await brainToolContext.get_my_stats(
          args as unknown as Parameters<typeof brainToolContext.get_my_stats>[0]
        );
        break;

      case TOOL_NAMES.GET_QBR_CONTEXT:
        result = await brainToolContext.get_qbr_context(
          args as unknown as Parameters<typeof brainToolContext.get_qbr_context>[0]
        );
        break;

      case TOOL_NAMES.PARTNERSHIP_FIT_ANALYSIS:
        result = await brainToolContext.partnership_fit_analysis(
          args as unknown as Parameters<typeof brainToolContext.partnership_fit_analysis>[0]
        );
        break;

      case TOOL_NAMES.POLICY_IMPACT_ANALYSIS:
        result = await brainToolContext.policy_impact_analysis(
          args as unknown as Parameters<typeof brainToolContext.policy_impact_analysis>[0]
        );
        break;

      case TOOL_NAMES.UPDATE_POLICY:
        const policyResult = await brainToolContext.update_policy(
          args as unknown as Parameters<typeof brainToolContext.update_policy>[0]
        );
        result = policyResult;
        costDeducted = policyResult.brain_cost || 0.01;
        break;

      case TOOL_NAMES.PROPOSE_PARTNERSHIP:
        result = await brainToolContext.propose_partnership(
          args as unknown as Parameters<typeof brainToolContext.propose_partnership>[0]
        );
        costDeducted = 0.005; // Partnership proposal cost
        break;

      case TOOL_NAMES.CREATE_INVESTOR_UPDATE:
        result = await brainToolContext.create_investor_update(
          args as unknown as Parameters<typeof brainToolContext.create_investor_update>[0]
        );
        costDeducted = (args.brain_cost as number) || 0.01;
        break;

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }

    logger.info(`[EXECUTOR] Tool executed successfully: ${toolName}`);

    return {
      toolName,
      success: true,
      result,
      costDeducted,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[EXECUTOR] Tool execution failed: ${toolName}`, errorMessage);

    return {
      toolName,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Execute multiple tools in sequence or parallel
 */
export async function executeToolBatch(
  tools: ToolRequest[],
  parallel: boolean = false
): Promise<ToolResponse[]> {
  logger.info(`[EXECUTOR] Executing tool batch (${tools.length} tools, parallel: ${parallel})`);

  if (parallel) {
    const promises = tools.map((tool) =>
      executeSingleTool(tool.name, tool.args)
    );
    return Promise.all(promises);
  } else {
    const results: ToolResponse[] = [];
    for (const tool of tools) {
      const result = await executeSingleTool(tool.name, tool.args);
      results.push(result);
    }
    return results;
  }
}

/**
 * Get total cost from tool responses
 */
export function getTotalCost(responses: ToolResponse[]): number {
  return responses.reduce((total, response) => total + (response.costDeducted || 0), 0);
}

/**
 * Check if all tools succeeded
 */
export function allSucceeded(responses: ToolResponse[]): boolean {
  return responses.every((response) => response.success);
}

/**
 * Get errors from failed tools
 */
export function getErrors(responses: ToolResponse[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const response of responses) {
    if (!response.success && response.error) {
      errors[response.toolName] = response.error;
    }
  }
  return errors;
}

/**
 * Format tool responses for logging
 */
export function formatToolResponses(responses: ToolResponse[]): string {
  const summary = responses
    .map(
      (r) =>
        `${r.toolName}: ${r.success ? "✓" : "✗"}${r.costDeducted ? ` ($${r.costDeducted})` : ""}`
    )
    .join(", ");
  return summary;
}
