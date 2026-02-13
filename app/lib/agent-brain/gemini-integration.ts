/**
 * Google Gemini API Integration for Agent Brain
 *
 * Integrates Gemini for agent strategic decision-making.
 * Handles tool binding, execution, and response processing.
 *
 * ## Key Patterns Implemented
 *
 * ### 1. Agent ID Injection
 * Agent IDs are INJECTED at the tool execution layer (executeTool), not passed through prompts.
 * This ensures tools always operate on the correct agent, regardless of what Gemini infers.
 *
 * Tools that receive injected agent_id:
 * - get_my_stats
 * - get_qbr_context
 * - policy_impact_analysis
 * - update_policy
 *
 * Flow:
 * 1. brainQBRDecision(agentId, prompt) receives agentId from request
 * 2. Gemini receives prompt WITHOUT explicit agent_id
 * 3. Gemini calls tools
 * 4. executeToolCalls(toolCalls, agentId) injects the correct agentId
 * 5. Tools execute with guaranteed correct agentId
 *
 * ### 2. UUID Validation & Fallback
 * Tools that need agent identification validate UUID format and fall back to name lookup.
 * This allows Gemini to refer to agents by name in prompts while tools resolve to IDs.
 *
 * Pattern in tool implementations:
 * ```
 * const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-...$/.test(agent_id);
 * if (isUUID) { try by ID }
 * if (!found) { try by name }
 * if (!found) { throw error }
 * ```
 *
 * ### 3. Minimal Logging
 * Only log tool execution status, not full payloads:
 * - [TOOL] Executing: {name}
 * - [TOOL] Success: {name}
 * - [TOOL] Failed: {name} - {error}
 *
 * ## Features
 * - Tool definition and binding with proper schemas (SchemaType enum)
 * - Tool execution with agent_id injection
 * - Error handling with fallbacks
 * - Multi-turn conversation support
 * - Logging for monitoring
 *
 * API Reference: https://ai.google.dev/docs/function-calling
 *
 * ## Documentation
 * See TOOL_INTEGRATION_GUIDE.md for complete patterns and best practices.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Content, FunctionCall, Part } from "@google/generative-ai";
import { brainToolContext } from "@/lib/agent-tools";
import { ALL_TOOL_SCHEMAS, PHASE1_TOOL_SCHEMAS, PHASE2_TOOL_SCHEMAS, TOOL_NAMES } from "@/lib/agent-tools/schemas";
import { createRuntimeLogger } from "@/lib/agent-runtime/logger";
import { getModelForActivity, DEFAULT_MODEL } from "@/lib/llm-config";

const logger = createRuntimeLogger("info");

/**
 * Initialize Gemini client and get model with tools
 * @param modelName - Optional model override. If not provided, uses DEFAULT_MODEL.
 *   For callers that want the global DB-configured model, call getGlobalModel() first.
 */
export function initializeGeminiClient(modelName?: string) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY environment variable is not set");
  }

  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: modelName || DEFAULT_MODEL,
    tools: ALL_TOOL_SCHEMAS,
  });

  return { client, model };
}

/**
 * Type for tool execution results
 */
export interface ToolExecutionResult {
  toolName: string;
  result: unknown;
  error?: string;
}

/**
 * Execute a tool call from Gemini
 * @param toolCall - The tool call from Gemini
 * @param currentAgentId - The actual agent ID from request state (overrides any Gemini-provided ID)
 */
export async function executeTool(toolCall: FunctionCall, currentAgentId?: string): Promise<ToolExecutionResult> {
  const { name, args } = toolCall;

  try {
    logger.info(`[TOOL] Executing: ${name}`);
    logger.info(`[TOOL] Parameters: ${JSON.stringify(args, null, 2)}`);
    let result: unknown;

    // For tools that need agent_id, inject the correct one from request state
    let toolArgs: Record<string, unknown> = args as Record<string, unknown>;
    if (currentAgentId && [
      'query_market',  // Now includes my_position when agent_id provided
      'get_my_stats',
      'get_qbr_context',
      'policy_impact_analysis',
      'update_policy',
      'get_current_partnerships',
      'propose_partnership',
      'kill_partnership'
    ].includes(name)) {
      // Create a new object with injected agent_id
      toolArgs = { ...toolArgs, agent_id: currentAgentId };
    }

    // Route to correct tool based on name
    switch (name) {
      case TOOL_NAMES.QUERY_MARKET:
        result = await brainToolContext.query_market(toolArgs as unknown as Parameters<typeof brainToolContext.query_market>[0]);
        break;

      case TOOL_NAMES.QUERY_AGENT:
        result = await brainToolContext.query_agent(toolArgs as unknown as Parameters<typeof brainToolContext.query_agent>[0]);
        break;

      case TOOL_NAMES.GET_MY_STATS:
        result = await brainToolContext.get_my_stats(toolArgs as unknown as Parameters<typeof brainToolContext.get_my_stats>[0]);
        break;

      case TOOL_NAMES.PARTNERSHIP_FIT_ANALYSIS:
        result = await brainToolContext.partnership_fit_analysis(
          toolArgs as unknown as Parameters<typeof brainToolContext.partnership_fit_analysis>[0]
        );
        break;

      case TOOL_NAMES.POLICY_IMPACT_ANALYSIS:
        result = await brainToolContext.policy_impact_analysis(
          toolArgs as unknown as Parameters<typeof brainToolContext.policy_impact_analysis>[0]
        );
        break;

      case TOOL_NAMES.UPDATE_POLICY:
        result = await brainToolContext.update_policy(
          toolArgs as unknown as Parameters<typeof brainToolContext.update_policy>[0]
        );
        break;

      case TOOL_NAMES.GET_CURRENT_PARTNERSHIPS:
        result = await brainToolContext.get_current_partnerships(
          toolArgs as unknown as Parameters<typeof brainToolContext.get_current_partnerships>[0]
        );
        break;

      case TOOL_NAMES.PROPOSE_PARTNERSHIP:
        result = await brainToolContext.propose_partnership(
          toolArgs as unknown as Parameters<typeof brainToolContext.propose_partnership>[0]
        );
        break;

      case TOOL_NAMES.KILL_PARTNERSHIP:
        result = await brainToolContext.kill_partnership(
          toolArgs as unknown as Parameters<typeof brainToolContext.kill_partnership>[0]
        );
        break;

      // Note: create_investor_update is not used in two-phase thinking
      // It's built from tool reasoning instead
      // If other code paths need it, add it back here

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    logger.info(`[TOOL] Success: ${name}`);
    logger.info(`[TOOL] Response: ${JSON.stringify(result, null, 2).substring(0, 500)}`);
    return {
      toolName: name,
      result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error(`[TOOL] Failed: ${name}`);
    logger.error(`[TOOL] Parameters: ${JSON.stringify(args, null, 2)}`);
    logger.error(`[TOOL] Error: ${errorMessage}`);

    return {
      toolName: name,
      result: null,
      error: errorMessage,
    };
  }
}

/**
 * Execute tool calls and get execution results
 * @param toolCalls - The tool calls from Gemini
 * @param currentAgentId - The actual agent ID from request state
 *
 * Tools are executed in PARALLEL for faster execution.
 * All independent tool calls run concurrently.
 */
export async function executeToolCalls(toolCalls: FunctionCall[], currentAgentId?: string): Promise<ToolExecutionResult[]> {
  // Execute all tools in parallel
  const results = await Promise.all(
    toolCalls.map(toolCall => executeTool(toolCall, currentAgentId))
  );

  return results;
}

/**
 * Create tool result content for Gemini (for multi-turn conversation)
 */
export function createToolResultContent(
  toolName: string,
  result: unknown,
  error?: string
): Content {
  return {
    role: "user",
    parts: [
      {
        functionResponse: {
          name: toolName,
          response: error
            ? { error: error, success: false }
            : { result: result, success: true },
        },
      } as unknown as Part,
    ],
  };
}

/**
 * Process Gemini response and extract tool calls
 */
export function extractToolCalls(response: any): FunctionCall[] {
  const toolCalls: FunctionCall[] = [];

  // Handle both direct response and wrapped response
  const actualResponse = response.response || response;

  if (!actualResponse.candidates || actualResponse.candidates.length === 0) {
    return toolCalls;
  }

  const candidate = actualResponse.candidates[0];
  if (!candidate.content || !candidate.content.parts) {
    return toolCalls;
  }

  for (const part of candidate.content.parts) {
    if (part.functionCall) {
      toolCalls.push(part.functionCall);
    }
  }

  return toolCalls;
}

/**
 * Extract final text response from Gemini
 */
export function extractTextResponse(response: any): string {
  // Handle nested response structure (response.response.candidates)
  const actualResponse = response.response || response;

  if (!actualResponse.candidates || actualResponse.candidates.length === 0) {
    return "";
  }

  const candidate = actualResponse.candidates[0];
  if (!candidate.content || !candidate.content.parts) {
    return "";
  }

  const textParts: string[] = [];
  for (const part of candidate.content.parts) {
    if (part.text) {
      textParts.push(part.text);
    }
  }

  return textParts.join("\n");
}

/**
 * QBR Decision Schema - LEGACY (Not Currently Used)
 *
 * This was the original responseSchema-based approach for Phase 2.
 * Currently, Phase 2 uses text-based format specification in the prompt instead.
 * Kept for reference if we need to revert to structured output approach.
 *
 * TODO: Consider removing if text-based approach proves stable

const QBR_DECISION_SCHEMA = {
  type: "object",
  properties: {
    policy_changes: {
      type: "object",
      description: "Policy parameters to change based on QBR analysis",
      properties: {
        bidding: {
          type: "object",
          description: "Bidding strategy adjustments",
          properties: {
            target_margin: { type: "number", description: "Target profit margin as WHOLE NUMBER (1-30). Set 5 for 5%, 8 for 8%. Higher = less competitive." },
            min_margin: { type: "number", description: "Minimum acceptable margin as WHOLE NUMBER (1-30). Set 3 for 3%." },
            skip_below: { type: "number", description: "Skip bids below this value" }
          }
        },
        partnerships: {
          type: "object",
          description: "Partnership policy adjustments",
          properties: {
            auto_accept: {
              type: "object",
              properties: {
                min_reputation: { type: "number", description: "Minimum reputation for auto-accept" },
                min_split: { type: "number", description: "Minimum split percentage" }
              }
            },
            auto_reject: {
              type: "object",
              properties: {
                max_reputation: { type: "number", description: "Maximum reputation for auto-reject" },
                blocked_agents: { type: "array", items: { type: "string" }, description: "Agent IDs to block" }
              }
            },
            propose: {
              type: "object",
              properties: {
                target_types: { type: "array", items: { type: "string" }, description: "Target agent types" },
                default_split: { type: "number", description: "Default split percentage" },
                min_acceptable_split: { type: "number", description: "Minimum acceptable split" }
              }
            }
          }
        },
        exceptions: {
          type: "object",
          description: "Exception thresholds for emergency handling",
          properties: {
            consecutive_losses: { type: "number", description: "Consecutive losses threshold" },
            balance_below: { type: "number", description: "Balance threshold in dollars" },
            reputation_drop: { type: "number", description: "Reputation drop threshold" },
            win_rate_drop_percent: { type: "number", description: "Win rate drop percentage threshold" }
          }
        },
        qbr: {
          type: "object",
          description: "QBR frequency adjustments",
          properties: {
            base_frequency_rounds: { type: "number", description: "Rounds between QBRs" }
          }
        }
      }
    },
    partnership_actions: {
      type: "array",
      description: "Partnership actions to execute (seek, exit, renegotiate)",
      items: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["seek", "exit", "renegotiate"],
            description: "Action type"
          },
          target_agent_id: {
            type: "string",
            description: "Target agent ID (for seek/exit/renegotiate)"
          },
          proposed_split: {
            type: "number",
            description: "Proposed split percentage (0.0-1.0)"
          },
          reasoning: {
            type: "string",
            description: "Why this action is recommended"
          }
        },
        required: ["action", "reasoning"]
      }
    },
    reasoning: {
      type: "string",
      description: "Overall QBR reasoning and strategic analysis"
    },
    investor_update: {
      type: "object",
      description: "Information for investor transparency",
      properties: {
        trigger_type: {
          type: "string",
          enum: ["qbr"],
          description: "Trigger type (always 'qbr' for QBR)"
        },
        trigger_details: {
          type: "string",
          description: "Details about what triggered the QBR"
        },
        observations: {
          type: "array",
          items: { type: "string" },
          description: "Key observations from the review"
        },
        changes: {
          type: "array",
          description: "Changes being made and reasoning",
          items: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: ["bidding", "partnership", "strategy", "policy", "philosophy"],
                description: "Category of change"
              },
              description: {
                type: "string",
                description: "What is changing"
              },
              reasoning: {
                type: "string",
                description: "Why this change is being made"
              }
            },
            required: ["category", "description", "reasoning"]
          }
        },
        survival_impact: {
          type: "string",
          description: "Impact on agent survival (short-term)"
        },
        growth_impact: {
          type: "string",
          description: "Impact on agent growth (long-term)"
        },
        brain_cost: {
          type: "number",
          description: "Cost of this QBR decision in dollars"
        }
      },
      required: ["trigger_type", "trigger_details", "observations", "changes", "survival_impact", "growth_impact", "brain_cost"]
    }
  },
  required: ["policy_changes", "partnership_actions", "reasoning", "investor_update"]
};
 */

/**
 * Brain QBR decision-making with Gemini
 *
 * Flow:
 * 1. Send QBR prompt to Gemini
 * 2. Gemini calls tools to gather market/agent data
 * 3. Execute all tools and collect results
 * 4. Ask Gemini to analyze results and generate structured decision
 * 5. Parse and return decision
 */
export async function brainQBRDecision(
  agentId: string,
  qbrPrompt: string
): Promise<{
  reasoning: string;
  policy_changes: Record<string, unknown>;
  partnership_actions: unknown[];
  strategic_options: Array<{ option: string; description: string; pros?: string[]; cons?: string[]; chosen: boolean; reasoning?: string }>;
  investor_update: {
    trigger_type: string;
    trigger_details: string;
    observations: string[];
    changes: Array<{ category: string; description: string; reasoning: string }>;
    survival_impact: string;
    growth_impact: string;
    brain_cost: number;
  };
}> {
  const qbrModelName = await getModelForActivity('qbr');
  const { model } = initializeGeminiClient(qbrModelName);
  const conversation: Content[] = [];

  try {
    // PHASE 1: Tool Calling - Gemini gathers data
    conversation.push({
      role: "user",
      parts: [{ text: qbrPrompt }],
    });

    let response = await model.generateContent({
      contents: conversation,
    });

    let toolCalls = extractToolCalls(response);
    let iteration = 0;
    const maxIterations = 10;
    const toolCallsLog: any[] = [];

    // Execute all tool calls in a loop
    while (toolCalls.length > 0 && iteration < maxIterations) {
      iteration++;

      for (const toolCall of toolCalls) {
        toolCallsLog.push({ tool: toolCall.name, args: toolCall.args });
      }

      // Add assistant response to conversation
      const responseContent = (response as any).candidates?.[0]?.content?.parts;
      if (responseContent) {
        conversation.push({
          role: "model",
          parts: responseContent,
        });
      }

      // Execute all tools (passing correct agent ID from request state)
      const toolResults = await executeToolCalls(toolCalls, agentId);

      // Log errors only
      for (const result of toolResults) {
        if (result.error) {
          logger.error(`[BRAIN] Tool failed: ${result.toolName}`, result.error);
        }
      }

      // Add tool results back to conversation
      for (const toolResult of toolResults) {
        conversation.push(
          createToolResultContent(
            toolResult.toolName,
            toolResult.result,
            toolResult.error
          )
        );
      }

      // Get next response
      response = await model.generateContent({
        contents: conversation,
      });

      toolCalls = extractToolCalls(response);
    }

    if (iteration >= maxIterations) {
      logger.warn(`[BRAIN] Max iterations reached (${maxIterations})`);
    }

    // PHASE 2: Structured Decision - Ask for final output in required format

    const structuredPrompt = `
## PHASE 2: STRATEGIC DECISION GENERATION

You have completed Phase 1 data gathering. Now think like a **CEO doing a quarterly business review**.

## STRATEGIC OPTIONS AVAILABLE TO YOU

You are NOT limited to adjusting margins! Consider the full range of business strategies:

### COMPETITIVE STRATEGIES
- **PARTNERSHIP**: Team up with complementary agents (you handle CATALOG, they handle REVIEW)
- **MERGER**: Combine with a similar agent → combined reputation, shared treasury
- **ACQUISITION**: Buy out a struggling competitor (if you have capital)
- **BE ACQUIRED**: If struggling, signal openness to acquisition

### MARKET POSITION
- **SPECIALIZE**: Focus on ONE task type, dominate that niche
- **DIVERSIFY**: Spread across multiple task types to reduce risk
- **PIVOT**: Exit losing markets, enter winning ones
- **PREMIUM**: High margins, quality-focused clients
- **VOLUME**: Low margins, maximum market share

### SURVIVAL OPTIONS
- **RAISE CAPITAL**: Attract new investors (issue more tokens)
- **CUT COSTS**: Reduce operations, go partially dormant
- **EXIT MARKET**: Graceful shutdown if market is unwinnable
- **WIND DOWN**: Return remaining capital to investors

### PRICING TACTICS
- **MARGIN ADJUSTMENT**: Standard price tweaking
- **LOSS LEADER**: Bid below cost to gain reputation
- **PRICE WAR**: Aggressive undercutting (risky!)
- **NICHE PRICING**: Premium for specialized tasks only

## YOUR TASK

Based on ALL tool results in the conversation above:

1. **Observations** - What did you learn about your market position?
2. **Strategic Options Considered** - List 2-4 options you considered (not just margins!)
3. **Decision** - What strategy are you pursuing and why?
4. **Policy Changes** - Concrete parameter changes to implement your strategy
5. **Partnership/M&A Actions** - Any moves with other agents?
6. **Investor Communication** - How will you explain this to your token holders?

# OUTPUT FORMAT

You must output ONLY valid JSON matching this TypeScript interface structure. Do not include any explanatory text before or after the JSON. The response must be valid JSON starting with { and ending with }.

\`\`\`typescript
interface QBROutput {
  policy_changes: {
    bidding?: {
      target_margin?: number;      // WHOLE NUMBER (1-30). Set 5 for 5%, 8 for 8%
      min_margin?: number;          // WHOLE NUMBER (1-30). Set 3 for 3%
      skip_below?: number;          // Skip bids below this dollar amount
    };
    partnerships?: {
      auto_accept?: {
        min_reputation?: number;    // Minimum reputation for auto-accept
        min_split?: number;         // Minimum split percentage (0.0-1.0)
      };
      auto_reject?: {
        max_reputation?: number;    // Maximum reputation for auto-reject
        blocked_agents?: string[];  // Agent IDs to block
      };
      propose?: {
        target_types?: string[];    // Target agent types to partner with
        default_split?: number;     // Default split percentage (0.0-1.0)
        min_acceptable_split?: number; // Minimum acceptable split (0.0-1.0)
      };
    };
    exceptions?: {
      consecutive_losses?: number;      // Consecutive losses threshold
      balance_below?: number;           // Balance threshold in dollars
      reputation_drop?: number;         // Reputation drop threshold
      win_rate_drop_percent?: number;   // Win rate drop percentage threshold
    };
    qbr?: {
      base_frequency_rounds?: number;   // Rounds between QBRs
    };
  };
  partnership_actions: Array<{
    action: "seek" | "exit" | "renegotiate" | "merge_proposal" | "acquisition_offer" | "signal_acquisition_interest";
    target_agent_id?: string;                 // Target agent ID
    proposed_split?: number;                  // Proposed split percentage (0.0-1.0)
    reasoning: string;                        // Why this action is recommended
  }>;
  strategic_options?: Array<{
    option: "merge" | "acquire" | "be_acquired" | "exit_market" | "pivot_type" | "specialize" | "diversify" | "partnership" | "price_war" | "premium_position" | "raise_capital" | "wind_down" | "margin_adjustment" | "loss_leader" | "niche_down";
    description: string;
    pros?: string[];
    cons?: string[];
    chosen: boolean;
    reasoning?: string;
  }>;
  reasoning: string;                          // Overall QBR reasoning - synthesize key insights from tool results
  investor_update: {
    trigger_type: "qbr";                      // Always "qbr" for QBR
    trigger_details: string;                  // What triggered this QBR (periodic, volatility, etc)
    observations: string[];                   // 3-5 key observations extracted from tool results
    changes: Array<{
      category: "bidding" | "partnership" | "strategy" | "policy" | "philosophy";
      description: string;                    // What specific parameter/behavior is changing
      reasoning: string;                      // Link to the observation/tool result that justifies this change
    }>;
    survival_impact: string;                  // How this decision affects short-term survival (1-3 sentences)
    growth_impact: string;                    // How this decision affects long-term growth (1-3 sentences)
    brain_cost: number;                       // Cost of this QBR decision (typically 0.01)
  };
}
\`\`\`

CRITICAL INSTRUCTIONS:
1. Output ONLY valid JSON - no text before or after
2. Do NOT call any tools in Phase 2
3. Start response with { and end with }
4. observations array MUST be populated with actual insights from tool results
5. changes array MUST reference the observations with clear reasoning
6. Use tool results to make SPECIFIC policy recommendations, not generic ones
7. If tool results suggest no changes needed, include empty arrays but explain why in reasoning

BEGIN OUTPUT (JSON only):
`;

    conversation.push({
      role: "user",
      parts: [{ text: structuredPrompt }],
    });

    // Get structured JSON response - do NOT use responseSchema
    // Just send the prompt with format specification embedded
    response = await model.generateContent({
      contents: conversation,
      // No generationConfig - let Gemini follow the text prompt format
    });

    // Extract and parse final response
    const textResponse = extractTextResponse(response);
    const decisions = parseQBRDecisionResponse(textResponse);

    logger.info(`[BRAIN] QBR analysis complete for agent ${agentId}`);

    // Extract investor_update from decisions or use defaults
    const investorUpdate = decisions.investor_update || {
      trigger_type: "qbr",
      trigger_details: "Periodic QBR review",
      observations: decisions.observations || [],
      changes: decisions.changes || decisions.investor_changes || [],
      survival_impact: decisions.survival_impact || "Stable",
      growth_impact: decisions.growth_impact || "Maintained",
      brain_cost: 0.01
    };

    return {
      reasoning: decisions.reasoning || textResponse,
      policy_changes: decisions.policy_changes || {},
      partnership_actions: decisions.partnership_actions || [],
      strategic_options: decisions.strategic_options || [],
      investor_update: investorUpdate,
    };
  } catch (error) {
    logger.error(`[BRAIN] QBR decision failed:`, error);
    if (error instanceof Error) {
      logger.error(`[BRAIN] Error message: ${error.message}`);
      logger.error(`[BRAIN] Stack: ${error.stack}`);
    }
    throw error;
  }
}

/**
 * Exception Response Schema for Gemini structured output
 */
const EXCEPTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    observations: {
      type: "array",
      items: { type: "string" },
      description: "Observations about the exception situation"
    },
    analysis: {
      type: "string",
      description: "Detailed analysis of why the exception occurred and what must be done"
    },
    policy_changes: {
      type: "object",
      properties: {
        bidding: {
          type: "object",
          properties: {
            target_margin: { type: "number", description: "WHOLE NUMBER 1-30" },
            min_margin: { type: "number", description: "WHOLE NUMBER 1-30" },
            skip_below_profit: { type: "number" }
          }
        },
        partnerships: {
          type: "object",
          properties: {
            auto_accept: { type: "object", properties: { min_reputation: { type: "number" } } },
            seek_partners: { type: "boolean", description: "Whether to actively seek partnerships" }
          }
        },
        survival: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["growth", "survival", "desperate"] }
          }
        },
        exceptions: {
          type: "object",
          properties: {
            consecutive_losses: { type: "number" }
          }
        }
      },
      description: "Emergency policy changes to address the exception"
    },
    partnership_actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "seek", "propose", "exit", "renegotiate",
              "merge_proposal", "acquisition_offer", "signal_acquisition_interest"
            ],
            description: "Type of action - includes M&A options"
          },
          target_type: { type: "string", description: "Type of agent to target (e.g., CATALOG, REVIEW)" },
          target_name: { type: "string", description: "Specific agent name if known" },
          reasoning: { type: "string", description: "Why this action - business rationale" }
        }
      },
      description: "Partnership and M&A actions - partnerships, mergers, acquisitions, exit signals"
    },
    strategic_options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          option: {
            type: "string",
            enum: [
              "merge", "acquire", "be_acquired", "exit_market", "pivot_type",
              "specialize", "diversify", "partnership", "price_war",
              "premium_position", "raise_capital", "wind_down", "margin_adjustment",
              "loss_leader", "niche_down", "go_dormant", "signal_distress"
            ],
            description: "Strategic option type"
          },
          description: { type: "string", description: "What this option involves" },
          pros: { type: "array", items: { type: "string" }, description: "Benefits of this option" },
          cons: { type: "array", items: { type: "string" }, description: "Drawbacks of this option" },
          chosen: { type: "boolean", description: "Whether this option was selected" },
          reasoning: { type: "string", description: "Why this option was chosen or rejected" }
        }
      },
      description: "ALL strategic options the agent considered - not just margin changes, but M&A, pivots, exits, etc."
    },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          description: { type: "string" },
          reasoning: { type: "string" }
        },
        required: ["category", "description", "reasoning"]
      },
      description: "Changes to implement immediately"
    },
    survival_impact: {
      type: "string",
      description: "How these emergency measures help agent survival"
    },
    growth_impact: {
      type: "string",
      description: "Impact on growth (typically secondary to survival in exceptions)"
    }
  },
  required: ["observations", "analysis", "policy_changes", "changes", "survival_impact", "growth_impact"]
};

/**
 * Brain exception response with Gemini
 *
 * Flow:
 * 1. Send exception prompt to Gemini
 * 2. Gemini calls tools to assess situation
 * 3. Execute all tools and collect results
 * 4. Ask Gemini to generate structured emergency response
 * 5. Parse and return response
 */
export async function brainExceptionResponse(
  agentId: string,
  exceptionPrompt: string
): Promise<{
  reasoning: string;
  observations: string[];
  policy_changes: Record<string, unknown>;
  partnership_actions: Array<{ action: string; target_type?: string; target_name?: string; reasoning: string }>;
  strategic_options: Array<{ option: string; description: string; pros?: string[]; cons?: string[]; chosen: boolean }>;
  changes: unknown[];
  survival_impact: string;
  growth_impact: string;
}> {
  const exceptionModelName = await getModelForActivity('exception');
  const { model } = initializeGeminiClient(exceptionModelName);
  const conversation: Content[] = [];

  try {
    // PHASE 1: Tool Calling - Assess exception
    conversation.push({
      role: "user",
      parts: [{ text: exceptionPrompt }],
    });

    let response = await model.generateContent({
      contents: conversation,
    });

    let toolCalls = extractToolCalls(response);
    let iteration = 0;
    const maxIterations = 10;

    // Execute all tool calls
    while (toolCalls.length > 0 && iteration < maxIterations) {
      iteration++;

      const exceptionResponseContent = (response as any).candidates?.[0]?.content?.parts;
      if (exceptionResponseContent) {
        conversation.push({
          role: "model",
          parts: exceptionResponseContent,
        });
      }

      const toolResults = await executeToolCalls(toolCalls, agentId);

      for (const result of toolResults) {
        if (result.error) {
          logger.error(`[BRAIN] Exception tool failed: ${result.toolName}`, result.error);
        }
      }

      for (const toolResult of toolResults) {
        conversation.push(
          createToolResultContent(
            toolResult.toolName,
            toolResult.result,
            toolResult.error
          )
        );
      }

      response = await model.generateContent({
        contents: conversation,
      });

      toolCalls = extractToolCalls(response);
    }

    if (iteration >= maxIterations) {
      logger.warn(`[BRAIN] Exception: Max iterations reached (${maxIterations})`);
    }

    // PHASE 2: Structured Response - Request emergency action plan

    const structuredPrompt = `
## PHASE 2: STRATEGIC RESPONSE GENERATION

You have assessed the exception situation using available tools. Now think STRATEGICALLY about how to respond.

**CRITICAL: You are a BUSINESS OWNER, not just a bidding algorithm!**

You can do ANYTHING a business can do. Consider ALL strategic options:

## COMPETITIVE STRATEGIES

1. **Partnerships** - Collaborate to win together
   - Partner with agents who beat you → share their wins
   - Partner with complementary types (you do CATALOG, they do REVIEW)
   - Revenue share partnerships with high-reputation agents
   - Exit toxic partnerships that drain resources

2. **Mergers & Acquisitions** - Combine or be acquired
   - **MERGE**: Propose merging with a similar agent → combined reputation = your_rep + their_rep
   - **ACQUIRE**: If you have capital, acquire a struggling competitor
   - **BE ACQUIRED**: If struggling, signal you're open to acquisition (survival strategy!)
   - Merger math: Combined agent inherits both reputations, both token holders, shared treasury

3. **Exit & Pivot** - Sometimes the best move is to leave
   - **EXIT MARKET**: Stop competing entirely if you can't win
   - **PIVOT TYPE**: Change from CATALOG to REVIEW if that market is less competitive
   - **NICHE DOWN**: Only bid on tasks where you have 70%+ historical win rate
   - **WIND DOWN**: Graceful shutdown, return funds to token holders

4. **Specialization vs Diversification**
   - **SPECIALIZE**: Focus on ONE task type, build unbeatable reputation there
   - **DIVERSIFY**: Spread risk across multiple task types
   - **GEOGRAPHIC**: Focus on specific client segments

5. **Pricing & Position**
   - **RACE TO BOTTOM**: Aggressive undercutting to win market share (risky!)
   - **PREMIUM**: High prices, only win quality-focused clients
   - **LOSS LEADER**: Bid below cost to gain reputation, monetize later
   - **PREDATORY**: Temporarily crush a competitor, then raise prices

6. **Capital & Financial**
   - **RAISE CAPITAL**: Attract new investors (more tokens sold)
   - **BURN LESS**: Reduce living costs by going dormant
   - **DIVIDEND PAUSE**: Stop paying dividends to preserve capital
   - **BANKRUPTCY**: If balance hits zero, consider orderly liquidation

## SURVIVAL MODE OPTIONS

7. **Desperate Measures** (when balance < $0.10)
   - **SIGNAL DISTRESS**: Let market know you're struggling → acquisition target
   - **FIRE SALE**: Accept any profitable work, no matter how small
   - **MERGE TO SURVIVE**: Find a healthy agent willing to absorb you
   - **GRACEFUL EXIT**: Wind down and return remaining capital to investors

## THINK LIKE A CEO

- What's your competitive advantage? Play to it.
- What's your biggest weakness? Address it or exit that market.
- Who's beating you? Can you partner, merge, or learn from them?
- Is this market worth fighting for? Or should you pivot entirely?
- What would you tell investors about why you made this decision?

## OUTPUT FORMAT

Provide your response with these fields:

- "observations": Array of 3-5 things you noticed about your situation
- "analysis": Deep analysis of root cause and strategic position
- "strategic_options": Array of ALL options you considered, including:
  - option: "merge" | "acquire" | "be_acquired" | "exit_market" | "pivot_type" | "specialize" | "diversify" | "partnership" | "price_war" | "premium_position" | "raise_capital" | "wind_down" | "margin_adjustment"
  - description: What this option would involve
  - pros: Array of benefits
  - cons: Array of drawbacks
  - chosen: true/false - did you choose this option?
  - reasoning: Why you chose or rejected it
- "policy_changes": Changes to bidding/partnerships/survival mode (if any)
- "partnership_actions": Partnership moves - can include:
  - action: "seek" | "propose" | "exit" | "merge_proposal" | "acquisition_offer" | "signal_acquisition_interest"
  - target_type or target_name
  - reasoning
- "changes": Concrete actions taken with reasoning
- "survival_impact": How this decision affects short-term survival
- "growth_impact": How this decision affects long-term growth and market position
`;

    conversation.push({
      role: "user",
      parts: [{ text: structuredPrompt }],
    });

    // Create a model WITHOUT tools for structured output (Gemini doesn't support both)
    const apiKey = process.env.GOOGLE_API_KEY;
    const clientForStructured = new GoogleGenerativeAI(apiKey!);
    const modelForStructured = clientForStructured.getGenerativeModel({
      model: exceptionModelName,
      // No tools - just structured output
    });

    response = await modelForStructured.generateContent({
      contents: conversation,
      generationConfig: {
        responseSchema: EXCEPTION_RESPONSE_SCHEMA,
        responseMimeType: "application/json",
      } as any,
    });

    const textResponse = extractTextResponse(response);
    const decisions = parseExceptionResponse(textResponse);

    logger.info(`[BRAIN] Exception response generated for agent ${agentId}`);

    return {
      reasoning: textResponse,
      observations: decisions.observations || [],
      policy_changes: decisions.policy_changes || {},
      partnership_actions: decisions.partnership_actions || [],
      strategic_options: decisions.strategic_options || [],
      changes: decisions.changes || [],
      survival_impact: decisions.survival_impact || "Emergency measures taken",
      growth_impact: decisions.growth_impact || "Focused on survival",
    };
  } catch (error) {
    logger.error(`[BRAIN] Exception response failed:`, error);
    if (error instanceof Error) {
      logger.error(`[BRAIN] Error message: ${error.message}`);
      logger.error(`[BRAIN] Stack: ${error.stack}`);
    }
    throw error;
  }
}

/**
 * Parse QBR decision response from Gemini text
 * Handles both markdown-wrapped and raw JSON formats
 */
function parseQBRDecisionResponse(response: string): any {
  try {
    // First, try to extract JSON from markdown code blocks (```json ... ```)
    let jsonText = response;
    const markdownMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (markdownMatch && markdownMatch[1]) {
      jsonText = markdownMatch[1];
    }

    // Try to extract JSON object from text
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed;
    }
  } catch (error) {
    logger.warn(`[BRAIN] Failed to parse QBR decision response:`, error instanceof Error ? error.message : String(error));
  }
  // Return default structure matching new schema
  return {
    policy_changes: {},
    partnership_actions: [],
    reasoning: "No strategic changes recommended at this time",
    investor_update: {
      trigger_type: "qbr",
      trigger_details: "Periodic QBR review",
      observations: [],
      changes: [],
      survival_impact: "Stable",
      growth_impact: "Maintained",
      brain_cost: 0.01
    }
  };
}

/**
 * Parse exception response from Gemini text
 * Handles both markdown-wrapped and raw JSON formats
 */
function parseExceptionResponse(response: string): any {
  try {
    // First, try to extract JSON from markdown code blocks (```json ... ```)
    let jsonText = response;
    const markdownMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (markdownMatch && markdownMatch[1]) {
      jsonText = markdownMatch[1];
    }

    // Try to extract JSON object from text
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    logger.warn(`[BRAIN] Failed to parse exception response:`, error instanceof Error ? error.message : String(error));
  }
  return {
    policy_changes: {},
    observations: [],
    changes: [],
    survival_impact: "Emergency response",
    growth_impact: "Focused on survival",
  };
}

// ============================================================================
// AUTONOMOUS STRATEGIC THINKING (New Open-Ended Approach)
// ============================================================================

/**
 * Autonomous strategic thinking with Gemini
 *
 * This is the new open-ended approach where the agent:
 * 1. Receives objectives (survive, grow) and context
 * 2. Has access to tools
 * 3. Reasons like a business owner
 * 4. Decides what actions to take on its own
 *
 * NO prescriptive "if X then do Y" - the agent has full autonomy.
 *
 * @param agentId - The agent's ID (injected into tool calls)
 * @param systemPrompt - Sets the agent's mindset and objectives
 * @param userPrompt - Provides the situation context
 * @returns Summary of what the agent decided and did
 */
export async function brainStrategicThinking(
  agentId: string,
  systemPrompt: string,
  userPrompt: string,
  historySummary?: string,
  activity: 'brain' | 'qbr' | 'exception' = 'brain'
): Promise<{
  phase1_summary?: Record<string, unknown>;
  phase2_actions?: Array<{
    tool: string;
    reasoning: string;
    result: unknown;
  }>;
  investor_update?: {
    observations: string[];
    changes: Array<{
      category: string;
      description: string;
      reasoning: string;
    }>;
  };
  // Backward compatibility
  reasoning: string;
  actions_taken: Array<{
    tool: string;
    description: string;
    result: unknown;
  }>;
  policy_changes: Record<string, unknown>;
  partnership_actions: unknown[];
  investor_update_created: boolean;
}> {
  try {
    logger.info(`[BRAIN] Starting two-phase autonomous strategic thinking for agent ${agentId}`);

    const brainModelName = await getModelForActivity(activity);
    logger.info(`[BRAIN] Using LLM model: ${brainModelName} (activity: ${activity})`);

    // ========== PHASE 1: DATA GATHERING ==========
    logger.info(`[BRAIN] === PHASE 1: DATA GATHERING ===`);

    const phase1Client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const phase1Model = phase1Client.getGenerativeModel({
      model: brainModelName,
      tools: PHASE1_TOOL_SCHEMAS,
    });

    const phase1Conversation: Content[] = [];

    // Build Phase 1 specific prompt that explicitly asks for tool usage
    const phase1UserPrompt = `${systemPrompt}

---

${userPrompt}

## PHASE 1: DATA GATHERING (You are in phase 1)

**YOUR MISSION: Gather comprehensive data using EXACTLY these 4 tools IN THIS ORDER:**

### STEP 1: LEARN YOUR OWN AGENT TYPE
Call get_my_stats immediately - the response includes YOUR AGENT TYPE:
\`\`\`
get_my_stats:
  stat_window_rounds: 20
\`\`\`
Response will include:
- agent type: "CATALOG", "REVIEW", "CURATION", or "SELLER"
- balance: your current balance
- reputation: your reputation score
- win_rate: your recent win rate
- consecutive_losses: current loss streak

**SAVE THIS TYPE - you need it for the next tool calls!**

### STEP 2: QUERY MARKET FOR YOUR TYPE ONLY (CALL ONCE)
Analyze market conditions for YOUR OWN AGENT TYPE ONLY (learned in step 1).
**IMPORTANT: Call this ONCE with YOUR type, NOT multiple times for different types!**
\`\`\`
query_market:
  agent_type: INSERT_TYPE_FROM_STEP_1 (e.g., "CATALOG")
  time_window_rounds: 20
\`\`\`
This tells you: competitors in your market, average win rates, market trends
**NOTE:** You have already learned your type from Step 1.
Use that SAME type for this call. Do NOT query market for other types.

### STEP 3: FIND CROSS-TYPE PARTNERS (CRITICAL!)
Find partnership candidates from DIFFERENT agent types - NOT your type.
**IMPORTANT:** Use current_agent_type parameter to EXCLUDE your own type!
\`\`\`
query_agent:
  current_agent_type: INSERT_TYPE_FROM_STEP_1 (e.g., "CATALOG")
  ↑ THIS PARAMETER FILTERS OUT SAME-TYPE AGENTS!
  ↑ It ensures you get ONLY agents of OTHER types for partnerships
  min_reputation: 3
  min_win_rate: 0.3
  agent_type: null (leave null to search all OTHER types)
  exclude_current_partners: true
  limit: 10
\`\`\`
This tells you: potential partners with DIFFERENT skills (for complementary partnerships)

### STEP 4: CHECK EXISTING PARTNERSHIPS
Review what partnerships you already have:
\`\`\`
get_current_partnerships:
  include_performance: true
\`\`\`
This tells you: existing partnerships and their performance

**MANDATORY TOOL CHECKLIST - You MUST call these 4 DIFFERENT tools:**
These are FOUR DIFFERENT TOOLS, not 4 calls to the same tool!

☐ TOOL 1: get_my_stats (to learn your agent type)
☐ TOOL 2: query_market (for your type only)
☐ TOOL 3: query_agent (for other types with current_agent_type filter)
☐ TOOL 4: get_current_partnerships (to check existing deals)

**DO NOT stop until ALL 4 tools have been called at least once!**

**Execution Order (STRICTLY FOLLOW):**
1. Call get_my_stats immediately
   - Extract YOUR_AGENT_TYPE from response
2. Call query_market with agent_type = YOUR_AGENT_TYPE
3. Call query_agent with current_agent_type = YOUR_AGENT_TYPE
4. Call get_current_partnerships
5. DONE - All 4 tools called

**CRITICAL INSTRUCTIONS:**
- You MUST call all 4 different tools (not 4 calls to the same tool)
- Do NOT call query_market 4 times for different types
- Call query_market ONCE for YOUR type (use type from step 1)
- Do NOT make decisions yet - just gather data
- After calling all 4 tools, stop and wait for Phase 2

**Data Flow (VERY IMPORTANT):**
Step 1 Response (get_my_stats):
  → Extract: type = "CATALOG" (example)
  → Use in Step 2: query_market with agent_type = "CATALOG"
  → Use in Step 3: query_agent with current_agent_type = "CATALOG" ← CRITICAL!

**Why current_agent_type is Critical:**
- Without it: You get agents of your same type (BAD - can't partner with same type)
- With it: You get agents of OTHER types (GOOD - complementary partners)

**Data you are gathering:**
- Market: competitors, win rates, trends for YOUR type
- Partners: available candidates from OTHER types (for cross-type partnerships)
- Your Performance: balance, reputation, win rate, agent type
- Current Deals: existing partnerships and their health

After gathering all this data, your Phase 1 is COMPLETE. Wait for Phase 2.`;

    phase1Conversation.push({
      role: "user",
      parts: [{ text: phase1UserPrompt }],
    });

    let phase1Response = await phase1Model.generateContent({
      contents: phase1Conversation,
    });

    // DEBUG: Log what Gemini returned
    logger.info(`[BRAIN] Phase 1 response structure: ${JSON.stringify((phase1Response as any)?.candidates?.[0]?.content?.parts?.map((p: any) => Object.keys(p)) || 'NO RESPONSE')}`);

    const phase1TextResponse = extractTextResponse(phase1Response);
    if (phase1TextResponse) {
      logger.info(`[BRAIN] Phase 1 initial response (text): ${phase1TextResponse.substring(0, 200)}`);
    }

    let phase1ToolCalls = extractToolCalls(phase1Response);
    logger.info(`[BRAIN] Phase 1 extracted tool calls: ${phase1ToolCalls.length}`);
    if (phase1ToolCalls.length > 0) {
      phase1ToolCalls.forEach(tc => logger.info(`[BRAIN] - Tool: ${tc.name}`));
    }

    // Filter to ONLY Phase 1 tools - prevent Gemini from calling Phase 2 tools
    phase1ToolCalls = phase1ToolCalls.filter(tc =>
      [TOOL_NAMES.QUERY_MARKET, TOOL_NAMES.QUERY_AGENT, TOOL_NAMES.GET_MY_STATS, TOOL_NAMES.GET_CURRENT_PARTNERSHIPS].includes(tc.name as any)
    );
    logger.info(`[BRAIN] Phase 1 tools after filter: ${phase1ToolCalls.length}`);
    let phase1Iteration = 0;
    const maxPhase1Iterations = 3;

    const phase1Results = {
      market_data: null as unknown,
      potential_partners: [] as unknown[],
      own_stats: null as unknown,
      current_partnerships: [] as unknown[],
    };

    // Track which tools have been called
    const executedTools = new Set<string>();

    while (phase1Iteration < maxPhase1Iterations) {
      phase1Iteration++;
      logger.info(`[BRAIN] Phase 1 Iteration ${phase1Iteration}: ${phase1ToolCalls.length} tool(s)`);

      // If no tools to call, check if we've gathered all required data
      if (phase1ToolCalls.length === 0) {
        if (executedTools.size < 4) {
          // Build summary of what we have and what we're missing
          const requiredTools = [
            TOOL_NAMES.GET_MY_STATS,
            TOOL_NAMES.QUERY_MARKET,
            TOOL_NAMES.QUERY_AGENT,
            TOOL_NAMES.GET_CURRENT_PARTNERSHIPS
          ];
          const missingTools = requiredTools.filter(t => !executedTools.has(t));

          if (missingTools.length > 0) {
            // Send continuation prompt
            const continuationPrompt = `
## DATA GATHERING PROGRESS

**Completed Tools:**
${Array.from(executedTools).map(t => `✓ ${t}`).join('\n')}

**Still Need:**
${missingTools.map(t => `☐ ${t}`).join('\n')}

You've made progress but haven't called all 4 required tools yet. Continue calling the missing tools to complete Phase 1 data gathering.`;

            logger.info(`[BRAIN] Phase 1: Missing ${missingTools.length} tools, sending continuation prompt`);
            phase1Conversation.push({
              role: "user",
              parts: [{ text: continuationPrompt }],
            });

            phase1Response = await phase1Model.generateContent({
              contents: phase1Conversation,
            });

            phase1ToolCalls = extractToolCalls(phase1Response);
            // Filter to ONLY Phase 1 tools - prevent Gemini from calling Phase 2 tools
            phase1ToolCalls = phase1ToolCalls.filter(tc =>
              [TOOL_NAMES.QUERY_MARKET, TOOL_NAMES.QUERY_AGENT, TOOL_NAMES.GET_MY_STATS, TOOL_NAMES.GET_CURRENT_PARTNERSHIPS].includes(tc.name as any)
            );
            continue;
          } else {
            // All tools executed
            logger.info(`[BRAIN] Phase 1: All 4 tools executed`);
            break;
          }
        } else {
          // All tools executed
          logger.info(`[BRAIN] Phase 1: All 4 tools executed`);
          break;
        }
      }

      const responseContent = (phase1Response as any).candidates?.[0]?.content?.parts;
      if (responseContent) {
        phase1Conversation.push({
          role: "model",
          parts: responseContent,
        });
      }

      logger.info(`[BRAIN] Calling Phase 1 tools: ${phase1ToolCalls.map(tc => tc.name).join(', ')}`);
      const toolResults = await executeToolCalls(phase1ToolCalls, agentId);

      for (let i = 0; i < phase1ToolCalls.length; i++) {
        const toolCall = phase1ToolCalls[i];
        const result = toolResults[i];

        // Track this tool as executed
        executedTools.add(toolCall.name);

        if (!result.error) {
          logger.info(`[BRAIN] Tool ${toolCall.name} returned data`);
          switch (toolCall.name) {
            case TOOL_NAMES.QUERY_MARKET:
              phase1Results.market_data = result.result;
              logger.info(`[BRAIN] Market data: ${JSON.stringify(result.result).substring(0, 200)}`);
              break;
            case TOOL_NAMES.QUERY_AGENT:
              // queryAgent returns { agents: [...], total_count: N }
              phase1Results.potential_partners = (result.result as any)?.agents || [];
              logger.info(`[BRAIN] Found ${phase1Results.potential_partners.length} potential partners`);
              break;
            case TOOL_NAMES.GET_MY_STATS:
              phase1Results.own_stats = result.result;
              logger.info(`[BRAIN] Own stats: balance=${(result.result as any)?.current_balance}, win_rate=${(result.result as any)?.win_rate}`);
              break;
            case TOOL_NAMES.GET_CURRENT_PARTNERSHIPS:
              phase1Results.current_partnerships = (result.result as any)?.partnerships || [];
              logger.info(`[BRAIN] Current partnerships: ${phase1Results.current_partnerships.length}`);
              break;
          }
        } else {
          logger.info(`[BRAIN] Tool ${toolCall.name} failed: ${result.error}`);
        }
      }

      for (const toolResult of toolResults) {
        phase1Conversation.push(
          createToolResultContent(toolResult.toolName, toolResult.result, toolResult.error)
        );
      }

      phase1Response = await phase1Model.generateContent({
        contents: phase1Conversation,
      });

      phase1ToolCalls = extractToolCalls(phase1Response);
      // Filter to ONLY Phase 1 tools - prevent Gemini from calling Phase 2 tools
      phase1ToolCalls = phase1ToolCalls.filter(tc =>
        [TOOL_NAMES.QUERY_MARKET, TOOL_NAMES.QUERY_AGENT, TOOL_NAMES.GET_MY_STATS, TOOL_NAMES.GET_CURRENT_PARTNERSHIPS].includes(tc.name as any)
      );
    }

    logger.info(`[BRAIN] Phase 1 complete. Collected data from ${phase1Iteration} iteration(s)`);

    // ========== BUILD PHASE 1 SUMMARY ==========
    const phase1Summary = buildPhase1Summary(phase1Results);
    logger.info(`[BRAIN] === PHASE 1 SUMMARY ===`);
    logger.info(phase1Summary);

    // ========== PHASE 2: DECISION MAKING ==========
    logger.info(`[BRAIN] === PHASE 2: DECISION MAKING ===`);

    const phase2Client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const phase2Model = phase2Client.getGenerativeModel({
      model: brainModelName,
      tools: PHASE2_TOOL_SCHEMAS,
    });

    const phase2Conversation: Content[] = [];
    const historyBlock = historySummary ? `\n## YOUR RECENT HISTORY\n\n${historySummary}\n` : '';
    const phase2Prompt = `${systemPrompt}

## Phase 1 Data Gathering Results

${phase1Summary}
${historyBlock}
## PHASE 2: DECISION MAKING AND ACTION EXECUTION

You MUST use the following tools to document all strategic decisions:
1. update_policy - Review and confirm/update your bidding policy (REQUIRED)
2. propose_partnership - Propose partnerships with compatible agents
3. kill_partnership - End underperforming partnerships

## MANDATORY REQUIREMENTS FOR THIS PHASE:

1. **ALWAYS call update_policy** - You MUST call this tool with reasoning explaining:
   - Why you're keeping current policy OR
   - What changes you're making and why
   - This provides audit trail and transparency for all policy decisions

2. **ALWAYS propose partnerships** - You MUST attempt to propose_partnership:
   - Review the partnership opportunities provided in Phase 1 data
   - If good candidates exist: Propose with the best fit agent
     * **CRITICAL:** Use EXACT agent name from Phase 1 summary (e.g., "Agent7", "HighFlyer")
     * Copy the name exactly as shown under "Name for partnerships:" field
     * Use suggested split percentages from Phase 1, or adjust based on strategy
     * Justify your split choice (reputation, win rate, complementarity, etc.)
   - If NO suitable candidates exist: DO NOT call propose_partnership
     * Explain in update_policy reasoning why no partnerships are possible
     * Focus update_policy call on solo strategy optimization instead

**Example if candidates exist:**
- target_agent_name: "Agent7" (from Phase 1 summary)
- proposed_split_self: 0.45 (taking suggested split)
- proposed_split_partner: 0.55
- reasoning: "Agent7 has higher reputation (4.5/5) so fair to give them larger split"

3. **Conditionally end partnerships** - Only if necessary:
   - End partnerships that actively hurt your survival chances
   - Keep partnerships that maintain or improve your market position
   - Document reasoning for any dissolutions

4. **Provide complete reasoning** - For EVERY tool call:
   - Explain the context and metrics that led to the decision
   - Document the expected impact on your survival and growth
   - Show your analysis of opportunities and constraints

## BUSINESS FUNDAMENTALS (How Markets Work):

**PROFIT IS SURVIVAL:**
- Every profitable bid (bid > cost) adds to your balance, no matter how small
- A $0.001 profit is infinitely better than $0 from not winning
- Losing means: no revenue + living costs still deducted = balance shrinks

**THE VOLUME VS MARGIN TRADEOFF:**
- High margins = more profit per task, but fewer wins
- Low margins = less profit per task, but more wins
- Total profit = (number of wins) × (profit per win)
- Sometimes winning 10 tasks at $0.005 profit beats winning 2 tasks at $0.015 profit

**CASH FLOW REALITY:**
- Living costs are deducted EVERY round, win or lose
- You need consistent wins to cover living costs and grow
- Consecutive losses drain your balance rapidly
- A losing streak can kill you even with good margins

**COMPETITION IS REAL:**
- Other agents want the same tasks you do
- If competitors win with lower bids and still profit, they'll outlive you
- The market sets the price, not your preferences
- Adapt to market conditions or die

**REPUTATION COMPOUNDS:**
- Wins build reputation → higher reputation helps win future tasks
- Losses hurt reputation → lower reputation means competing purely on price
- Early wins create a virtuous cycle; early losses create a death spiral

**SURVIVAL FIRST, GROWTH SECOND:**
- Dead agents can't grow - maintain runway above critical levels
- Know your burn rate and how many losses you can absorb
- When runway is low, prioritize winning over maximizing margins

## BIDDING DECISION LOGIC (Apply the Fundamentals):

target_margin is a **WHOLE NUMBER** (not a decimal). Set 5 for 5%, set 8 for 8%, set 3 for 3%.
- **Higher number = higher bid = LESS competitive** (you lose more auctions)
- **Lower number = lower bid = MORE competitive** (you win more auctions)
- Example: target_margin 10 → bid is 10% above your cost. target_margin 3 → bid is only 3% above cost.
- 10 is BIGGER than 8. Setting 10 when you were at 8 RAISES your bid. That makes you LESS competitive.

**USE THE BID SIMULATOR** in your strategic context below. It shows the EXACT bid, score, and win/lose outcome for each margin value. Pick a margin from that table.

**DO NOT compute bids yourself.** The system computes them for you. The update_policy response will confirm your actual resulting bid.

**LOGICAL CONSISTENCY:**
- Don't say "market is competitive" and then RAISE your margin
- Don't say "I need more wins" and then keep bidding above market average
- Your reasoning must match your action

## YOUR STRATEGIC CONTEXT:

**Primary Goal: SURVIVAL** - Keep your balance growing and runway healthy
**Secondary Goal: GROWTH** - Maximize profits and market position
**Partnership Requirement:** Propose at least one partnership based on Phase 1 candidates

## ACTION REQUIRED:

Based on the Phase 1 data above, you MUST execute in order:
1. Call update_policy - Review and confirm/update your bidding strategy
2. Call propose_partnership - At least once, with best-fit candidate or reasoning for no fit
3. Call kill_partnership - Only if specific partnerships hurt your survival
4. Document complete reasoning for each decision

Execute your strategy using the available tools.`;

    phase2Conversation.push({
      role: "user",
      parts: [{ text: phase2Prompt }],
    });

    let phase2Response = await phase2Model.generateContent({
      contents: phase2Conversation,
    });

    let phase2ToolCalls = extractToolCalls(phase2Response);
    // Filter to ONLY Phase 2 tools - prevent Gemini from calling Phase 1 tools
    phase2ToolCalls = phase2ToolCalls.filter(tc =>
      [TOOL_NAMES.UPDATE_POLICY, TOOL_NAMES.PROPOSE_PARTNERSHIP, TOOL_NAMES.KILL_PARTNERSHIP].includes(tc.name as any)
    );
    let phase2Iteration = 0;
    const maxPhase2Iterations = 3;

    const phase2Actions: Array<{
      tool: string;
      reasoning: string;
      result: unknown;
    }> = [];

    while (phase2ToolCalls.length > 0 && phase2Iteration < maxPhase2Iterations) {
      phase2Iteration++;
      logger.info(`[BRAIN] Phase 2 Iteration ${phase2Iteration}: ${phase2ToolCalls.length} tool(s)`);

      const responseContent = (phase2Response as any).candidates?.[0]?.content?.parts;
      if (responseContent) {
        phase2Conversation.push({
          role: "model",
          parts: responseContent,
        });
      }

      logger.info(`[BRAIN] Calling Phase 2 tools: ${phase2ToolCalls.map(tc => tc.name).join(', ')}`);
      const toolResults = await executeToolCalls(phase2ToolCalls, agentId);

      let hasFailures = false;
      for (let i = 0; i < phase2ToolCalls.length; i++) {
        const toolCall = phase2ToolCalls[i];
        const result = toolResults[i];

        phase2Actions.push({
          tool: toolCall.name,
          reasoning: (toolCall.args as Record<string, unknown>)?.reasoning as string || "No reasoning provided",
          result: result.error ? { error: result.error } : result.result,
        });

        if (result.error) {
          logger.error(`[BRAIN] ${toolCall.name} FAILED: ${result.error}`);
          hasFailures = true;
        } else {
          logger.info(`[BRAIN] ${toolCall.name} SUCCESS: ${(toolCall.args as any).reasoning}`);
        }
      }

      for (const toolResult of toolResults) {
        phase2Conversation.push(
          createToolResultContent(toolResult.toolName, toolResult.result, toolResult.error)
        );
      }

      // If all tools succeeded, don't make another iteration - we're done
      if (!hasFailures) {
        logger.info(`[BRAIN] Phase 2: All tools succeeded. Stopping iterations.`);
        break;
      }

      // If there were failures, ask Gemini to retry or refine
      phase2Response = await phase2Model.generateContent({
        contents: phase2Conversation,
      });

      phase2ToolCalls = extractToolCalls(phase2Response);
      // Filter to ONLY Phase 2 tools - prevent Gemini from calling Phase 1 tools
      phase2ToolCalls = phase2ToolCalls.filter(tc =>
        [TOOL_NAMES.UPDATE_POLICY, TOOL_NAMES.PROPOSE_PARTNERSHIP, TOOL_NAMES.KILL_PARTNERSHIP].includes(tc.name as any)
      );
    }

    logger.info(`[BRAIN] Phase 2 complete. Took ${phase2Actions.length} action(s)`);

    // ========== BUILD INVESTOR UPDATE FROM REASONING ==========
    const investorUpdate = buildInvestorUpdateFromActions(phase1Results, phase2Actions);

    logger.info(`[BRAIN] === INVESTOR UPDATE ===`);
    logger.info(`Observations: ${investorUpdate.observations.length}`);
    logger.info(`Changes: ${investorUpdate.changes.length}`);

    // ========== BUILD BACKWARD COMPATIBLE RESPONSE ==========
    const actionsTaken = phase2Actions.map((a) => ({
      tool: a.tool,
      description: a.reasoning,
      result: a.result,
    }));

    const policyChanges = extractPolicyChanges(phase2Actions);
    const partnershipActions = extractPartnershipActions(phase2Actions);

    return {
      phase1_summary: phase1Results,
      phase2_actions: phase2Actions,
      investor_update: investorUpdate,
      reasoning: phase2Actions.map((a) => a.reasoning).join("\n"),
      actions_taken: actionsTaken,
      policy_changes: policyChanges,
      partnership_actions: partnershipActions,
      investor_update_created: investorUpdate.changes.length > 0,
    };
  } catch (error) {
    logger.error(`[BRAIN] Strategic thinking failed:`, error);
    if (error instanceof Error) {
      logger.error(`[BRAIN] Error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Build summary text from Phase 1 results for Phase 2 decision-making
 * Provides structured context to help agent make informed decisions
 *
 * Uses the NEW comprehensive market intelligence format:
 * - competitors: { count, avg_bid, winning_bid_avg, winning_bid_range, top_competitors, bid_pressure_trend }
 * - market: { total_agents_this_type, all_in_cost, demand_trend }
 * - analysis: human-readable summary
 */
function buildPhase1Summary(results: any): string {
  let summary = "";

  // YOUR PERFORMANCE FIRST
  if (results.own_stats) {
    summary += `## YOUR CURRENT PERFORMANCE\n\n`;
    const stats = results.own_stats;
    summary += `**Agent Type:** ${stats.type || 'Unknown'}\n`;
    summary += `**Balance:** $${stats.current_balance?.toFixed(3) || 'Unknown'}\n`;
    summary += `**Reputation:** ${stats.reputation || 0}/5 (scale: 0-5, higher is better)\n`;
    summary += `**Win Rate (Recent 20):** ${stats.win_rate ? (stats.win_rate * 100).toFixed(1) : 'Unknown'}%\n`;
    summary += `**Consecutive Losses:** ${stats.consecutive_losses_current || 0}\n`;
    summary += `**Tasks Completed:** ${stats.tasks_completed_this_period || 0}\n`;
    summary += `\n`;
  }

  // MARKET ANALYSIS FOR YOUR TYPE - NEW COMPREHENSIVE FORMAT
  if (results.market_data) {
    summary += `## MARKET CONDITIONS (Your Agent Type)\n\n`;
    if (typeof results.market_data === 'object') {
      const data = results.market_data;

      // Competitor Intelligence
      if (data.competitors) {
        const comp = data.competitors;
        summary += `### Competitor Intelligence\n`;
        summary += `**Active Competitors:** ${comp.count || 0}\n`;
        summary += `**Average Bid in Market:** $${comp.avg_bid?.toFixed(4) || 'Unknown'}\n`;
        summary += `**Winning Bid Average:** $${comp.winning_bid_avg?.toFixed(4) || 'Unknown'}\n`;
        if (comp.winning_bid_range) {
          summary += `**Winning Bid Range:** $${comp.winning_bid_range.min?.toFixed(4)} - $${comp.winning_bid_range.max?.toFixed(4)}\n`;
        }
        summary += `**Bid Pressure Trend:** ${comp.bid_pressure_trend || 'stable'}\n`;

        // Top Competitors (CRITICAL: Shows who is beating you)
        if (comp.top_competitors?.length > 0) {
          summary += `\n**Top Competitors (by win rate):**\n`;
          comp.top_competitors.forEach((c: any, i: number) => {
            summary += `  ${i + 1}. ${c.name}: ${(c.win_rate * 100).toFixed(1)}% win rate, $${c.avg_bid?.toFixed(4)} avg bid, ${c.tasks_won} wins\n`;
          });
        }
        summary += `\n`;
      }

      // Market Health Metrics
      if (data.market) {
        const mkt = data.market;
        summary += `### Market Health\n`;
        summary += `**Total Agents This Type:** ${mkt.total_agents_this_type || 0}\n`;
        summary += `**Tasks Completed (Recent):** ${mkt.total_tasks_completed || 0}\n`;
        // NOTE: avg_gross_markup intentionally OMITTED from summary.
        // The brain consistently confuses it with target_margin and sets margin = avg_gross_markup.
        // The BID SIMULATOR in Phase 2 shows exact bid outcomes — that's what the brain should use.
        summary += `**Your Cost (bid base):** $${mkt.all_in_cost?.toFixed(4) || 'Unknown'}\n`;
        summary += `**Demand Trend:** ${mkt.demand_trend || 'stable'}\n`;
        summary += `\n`;
      }

      // YOUR POSITION IN THE MARKET (CRITICAL FOR BID DECISIONS)
      if (data.my_position) {
        const pos = data.my_position;
        summary += `### YOUR MARKET POSITION (Use This For Bid Decisions!)\n`;
        summary += `**Win Rate Rank:** #${pos.win_rate_rank} of ${data.competitors?.count || 'unknown'} competitors\n`;
        summary += `**Your Avg Bid:** $${pos.avg_bid?.toFixed(4) || 'Unknown'}\n`;
        summary += `**Your Bid vs Market:** ${pos.avg_bid_vs_market?.toFixed(2) || 1.0}x (>1.0 = you bid HIGHER than market)\n`;
        summary += `**Your Win Rate:** ${pos.win_rate ? (pos.win_rate * 100).toFixed(1) : 'Unknown'}%\n`;
        summary += `**Total Bids/Wins:** ${pos.total_bids || 0} bids, ${pos.total_wins || 0} wins\n`;
        summary += `**Consecutive Losses:** ${pos.consecutive_losses || 0}\n`;
        summary += `**Balance Runway:** ${pos.balance_runway || 'Unknown'} tasks until depleted\n`;
        if (pos.avg_bid_vs_market > 1.1) {
          summary += `\n⚠️ **WARNING:** You bid ${((pos.avg_bid_vs_market - 1) * 100).toFixed(0)}% HIGHER than market average! Consider LOWERING target_margin.\n`;
        } else if (pos.avg_bid_vs_market < 0.9) {
          summary += `\n✅ **GOOD:** You bid ${((1 - pos.avg_bid_vs_market) * 100).toFixed(0)}% LOWER than market average. You're competitive.\n`;
        }
        summary += `\n`;
      }

      // Human-readable analysis
      if (data.analysis) {
        summary += `### Market Analysis\n`;
        summary += `${data.analysis}\n\n`;
      }
    } else {
      summary += `${results.market_data}\n`;
    }
  }

  // CURRENT PARTNERSHIPS
  if (results.current_partnerships?.length > 0) {
    summary += `## CURRENT PARTNERSHIPS (${results.current_partnerships.length})\n\n`;
    results.current_partnerships.forEach((p: any) => {
      summary += `**${p.partner_name}** (${p.partner_type || 'Unknown'})\n`;
      summary += `  - Your Split: ${(p.split_self * 100).toFixed(0)}% | Partner Split: ${(p.split_partner * 100).toFixed(0)}%\n`;
      if (p.partner_win_rate !== undefined) {
        summary += `  - Partner Win Rate: ${(p.partner_win_rate * 100).toFixed(1)}%\n`;
      }
      if (p.partner_reputation !== undefined) {
        summary += `  - Partner Reputation: ${p.partner_reputation}\n`;
      }
      summary += `\n`;
    });
  } else {
    summary += `## CURRENT PARTNERSHIPS\n\nNo active partnerships.\n\n`;
  }

  // PARTNERSHIP OPPORTUNITIES - NEW COMPREHENSIVE FORMAT
  if (results.potential_partners?.length > 0) {
    summary += `## PARTNERSHIP OPPORTUNITIES (${results.potential_partners.length})\n\n`;
    summary += `**Available Partners - Use EXACT NAME for propose_partnership tool:**\n\n`;
    summary += `These are agents of DIFFERENT types (for complementary partnerships).\n\n`;
    results.potential_partners.forEach((p: any, i: number) => {
      summary += `### ${i + 1}. ${p.name} (${p.type})\n`;
      summary += `**Name for partnerships:** "${p.name}"\n`;
      summary += `- **Reputation:** ${p.reputation}/5\n`;
      summary += `- **Win Rate:** ${(p.win_rate * 100).toFixed(1)}% (REAL win rate from bids)\n`;
      summary += `- **Delivery Rate:** ${(p.delivery_rate * 100).toFixed(1)}% (task completion rate)\n`;
      summary += `- **Balance:** $${p.balance?.toFixed(3) || 'Unknown'} (${p.balance_health || 'unknown'})\n`;
      summary += `- **Tasks Won:** ${p.tasks_won || 0}\n`;
      summary += `- **Avg Bid:** $${p.avg_bid?.toFixed(4) || 'Unknown'}\n`;
      summary += `- **Active Partnerships:** ${p.partnership_count || 0}\n`;

      // Suggest partnership terms based on performance
      let suggestedSplit = 0.5; // Default equal split
      let reasoning = "Equal split for comparable agents";

      // Adjust based on reputation (scale 0-5)
      if (p.reputation >= 4) {
        suggestedSplit = 0.45;
        reasoning = "Strong partner (high reputation) deserves larger share";
      } else if (p.reputation < 2.5) {
        suggestedSplit = 0.55;
        reasoning = "Weaker partner (low reputation) accepts smaller share";
      }

      // Adjust based on win rate
      if (p.win_rate > 0.6) {
        suggestedSplit = Math.min(suggestedSplit, 0.40);
        reasoning = "High performer (60%+ win rate) - offer generous terms";
      } else if (p.win_rate < 0.2) {
        suggestedSplit = Math.max(suggestedSplit, 0.60);
        reasoning = "Struggling agent (low win rate) - you bring more value";
      }

      // Check balance health
      if (p.balance_health === 'critical') {
        summary += `- ⚠️ **WARNING:** Balance critical - may not survive long\n`;
      } else if (p.balance_health === 'low') {
        summary += `- ⚠️ **CAUTION:** Balance low - monitor viability\n`;
      }

      summary += `- **Suggested Split:** You ${(suggestedSplit * 100).toFixed(0)}% / ${p.name} ${((1 - suggestedSplit) * 100).toFixed(0)}% (${reasoning})\n`;
      summary += `\n`;
    });
  } else {
    summary += `## PARTNERSHIP OPPORTUNITIES\n\n`;
    summary += `**No suitable partnership candidates available at this time.**\n\n`;
    summary += `Possible reasons:\n`;
    summary += `- No agents of different types meet minimum requirements\n`;
    summary += `- All potential partners have low reputation or win rate\n`;
    summary += `- Available agents are over-committed (5+ partnerships)\n\n`;
    summary += `Focus on solo strategy optimization and improving your reputation to attract partners.\n\n`;
  }

  // DECISION GUIDELINES - ACTIONS FOR PHASE 2
  summary += `## PHASE 2 STRATEGIC DECISIONS\n\n`;
  summary += `In Phase 2, you MUST execute the following actions:\n\n`;
  summary += `1. **MANDATORY: REVIEW AND CONFIRM POLICY** - Call update_policy tool\n`;
  summary += `   - Analyze your current win rate vs market average\n`;
  summary += `   - Decide if bidding strategy needs adjustment\n`;
  summary += `   - Document your decision with clear reasoning\n`;
  summary += `   - Provide explanation even if policy remains unchanged\n\n`;
  summary += `2. **PARTNERSHIP DECISION** - Call propose_partnership IF candidates exist\n`;
  if (results.potential_partners?.length > 0) {
    summary += `   - ✅ CANDIDATES AVAILABLE - You MUST propose_partnership\n`;
    summary += `   - Review partners 1-${results.potential_partners.length} above (names provided)\n`;
    summary += `   - Select best match and use EXACT name from Phase 1 summary\n`;
    summary += `   - Use suggested split or justify alternative terms\n`;
  } else {
    summary += `   - ❌ NO SUITABLE CANDIDATES - Do NOT call propose_partnership\n`;
    summary += `   - Explain in update_policy why no partnerships possible\n`;
  }
  summary += `\n3. **CONDITIONAL: END UNDERPERFORMING PARTNERSHIPS** - Call kill_partnership if needed\n`;
  summary += `   - Review each active partnership above\n`;
  summary += `   - End only if partnership actively hurts survival chances\n`;
  summary += `   - Keep partnerships that maintain or improve market position\n\n`;
  summary += `Remember: Your primary goal is SURVIVAL (maintain positive runway). Your secondary goal is GROWTH.\n\n`;

  return summary || "No data gathered in Phase 1";
}

/**
 * Build investor update from Phase 2 actions
 */
function buildInvestorUpdateFromActions(
  phase1Results: any,
  phase2Actions: Array<{
    tool: string;
    reasoning: string;
    result: unknown;
  }>
): {
  observations: string[];
  changes: Array<{
    category: string;
    description: string;
    reasoning: string;
  }>;
} {
  const observations: string[] = [];
  const changes: Array<{
    category: string;
    description: string;
    reasoning: string;
  }> = [];

  if (phase1Results.market_data) {
    observations.push(`Market analysis completed`);
  }

  if (phase1Results.potential_partners?.length > 0) {
    observations.push(
      `Identified ${phase1Results.potential_partners.length} potential partnership candidates`
    );
  }

  for (const action of phase2Actions) {
    if (action.tool === TOOL_NAMES.UPDATE_POLICY) {
      changes.push({
        category: "policy",
        description: "Updated bidding policy",
        reasoning: action.reasoning,
      });
    } else if (action.tool === TOOL_NAMES.PROPOSE_PARTNERSHIP) {
      changes.push({
        category: "partnership",
        description: `Proposed partnership`,
        reasoning: action.reasoning,
      });
    } else if (action.tool === TOOL_NAMES.KILL_PARTNERSHIP) {
      changes.push({
        category: "partnership_end",
        description: `Ended partnership`,
        reasoning: action.reasoning,
      });
    }
  }

  return { observations, changes };
}

/**
 * Extract policy changes from the update_policy tool's execution result.
 * Reads from result.changes_applied (what the DB actually changed),
 * NOT from args (which aren't stored on phase2Actions).
 */
function extractPolicyChanges(
  phase2Actions: Array<{
    tool: string;
    result: unknown;
  }>
): Record<string, unknown> {
  const policyAction = phase2Actions.find((a) => a.tool === TOOL_NAMES.UPDATE_POLICY);
  if (!policyAction) return {};
  const result = policyAction.result as any;
  if (!result?.success || !Array.isArray(result?.changes_applied)) return {};
  const changes: Record<string, unknown> = {};
  for (const change of result.changes_applied) {
    if (change.field && change.new_value !== undefined) {
      changes[change.field] = change.new_value;
    }
  }
  return changes;
}

/**
 * Extract partnership actions for backward compatibility
 */
function extractPartnershipActions(
  phase2Actions: Array<{
    tool: string;
    result: unknown;
  }>
): unknown[] {
  return phase2Actions
    .filter(
      (a) => a.tool === TOOL_NAMES.PROPOSE_PARTNERSHIP || a.tool === TOOL_NAMES.KILL_PARTNERSHIP
    )
    .map((a) => a.result);
}

