/**
 * Brain - LLM Integration Module
 *
 * The Brain module handles all Claude API interactions for strategic decision-making.
 * It wakes only for:
 * 1. Initial policy generation (when agent is first created)
 * 2. Quarterly Business Reviews (scheduled strategic thinking)
 * 3. Exception handling (when something goes wrong)
 *
 * Each function:
 * - Builds prompts using prompt templates
 * - Calls Claude API
 * - Parses JSON responses
 * - Returns structured outputs
 * - Has safe fallbacks on API failure
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  AgentIdentity,
  BrainPolicyUpdate,
  QBRResult,
  ExceptionTrigger,
} from "./types";
import { buildInitialPolicyPrompt } from "./prompts/initial-policy";
import { buildQBRPrompt, type QBRContext } from "./prompts/qbr";
import {
  buildExceptionPrompt,
  type ExceptionContext,
} from "./prompts/exception";

/**
 * Brain configuration
 */
export interface BrainConfig {
  apiKey: string;
  model: string;
}

/**
 * Default model for brain operations
 */
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/**
 * Estimated token costs for brain wake-ups
 * These are rough estimates - actual costs vary by prompt length
 */
const ESTIMATED_COSTS = {
  initial_policy: 0.015,
  qbr: 0.02,
  exception: 0.012,
};

/**
 * Generate initial policy for a newly created agent
 *
 * @param identity - Agent identity (name, type, personality)
 * @param config - Brain configuration
 * @returns Policy update with initial settings and investor announcement
 */
export async function generateInitialPolicy(
  identity: AgentIdentity,
  config: BrainConfig
): Promise<BrainPolicyUpdate> {
  const client = new Anthropic({ apiKey: config.apiKey });
  const model = config.model || DEFAULT_MODEL;

  try {
    const { system, user } = buildInitialPolicyPrompt({
      name: identity.name,
      type: identity.type,
      personality: identity.personality,
    });

    const response = await client.messages.create({
      model,
      max_tokens: 2000,
      temperature: 0.7,
      system,
      messages: [
        {
          role: "user",
          content: user,
        },
      ],
    });

    // Extract text content from response
    const textContent = response.content.find((block) => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text content in Claude response");
    }

    // Parse JSON from response
    const parsed = parseJSONFromText(textContent.text);

    // Validate structure
    if (!parsed.policy || !parsed.investor_update) {
      throw new Error("Invalid response structure from Claude");
    }

    // Set brain cost estimate
    parsed.investor_update.brain_cost = ESTIMATED_COSTS.initial_policy;

    return {
      updated_policy: parsed.policy,
      reasoning: "Initial policy generated from personality defaults",
      investor_update: parsed.investor_update,
    };
  } catch (error) {
    console.error("[Brain] Error generating initial policy:", error);

    // Safe fallback: Return minimal policy based on personality defaults
    return generateFallbackInitialPolicy(identity);
  }
}

/**
 * Handle an exception that the autopilot escalated
 *
 * @param exception - Exception details
 * @param context - Current agent state and market context
 * @param config - Brain configuration
 * @returns Policy update addressing the exception
 */
export async function handleException(
  exception: ExceptionTrigger,
  context: ExceptionContext,
  config: BrainConfig
): Promise<BrainPolicyUpdate> {
  const client = new Anthropic({ apiKey: config.apiKey });
  const model = config.model || DEFAULT_MODEL;

  try {
    const { system, user } = buildExceptionPrompt(exception, context);

    const response = await client.messages.create({
      model,
      max_tokens: 2000,
      temperature: 0.7,
      system,
      messages: [
        {
          role: "user",
          content: user,
        },
      ],
    });

    // Extract text content from response
    const textContent = response.content.find((block) => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text content in Claude response");
    }

    // Parse JSON from response
    const parsed = parseJSONFromText(textContent.text);

    // Validate structure
    if (!parsed.updated_policy || !parsed.investor_update) {
      throw new Error("Invalid response structure from Claude");
    }

    // Set brain cost estimate
    parsed.investor_update.brain_cost = ESTIMATED_COSTS.exception;

    return {
      updated_policy: parsed.updated_policy,
      reasoning: parsed.reasoning || "Exception handling",
      investor_update: parsed.investor_update,
    };
  } catch (error) {
    console.error("[Brain] Error handling exception:", error);

    // Safe fallback: No policy change, generic investor update
    return generateFallbackExceptionResponse(exception, context);
  }
}

/**
 * Run a Quarterly Business Review
 *
 * @param context - Full agent context (stats, trends, market, partnerships)
 * @param config - Brain configuration
 * @returns Strategic decisions and policy updates
 */
export async function runQBR(
  context: QBRContext,
  config: BrainConfig
): Promise<QBRResult> {
  const client = new Anthropic({ apiKey: config.apiKey });
  const model = config.model || DEFAULT_MODEL;

  try {
    const { system, user } = buildQBRPrompt(context);

    const response = await client.messages.create({
      model,
      max_tokens: 3000,
      temperature: 0.7,
      system,
      messages: [
        {
          role: "user",
          content: user,
        },
      ],
    });

    // Extract text content from response
    const textContent = response.content.find((block) => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text content in Claude response");
    }

    // Parse JSON from response
    const parsed = parseJSONFromText(textContent.text);

    // Validate structure
    if (!parsed.investor_update) {
      throw new Error("Invalid response structure from Claude");
    }

    // Set brain cost estimate
    parsed.investor_update.brain_cost = ESTIMATED_COSTS.qbr;

    return {
      policy_changes: parsed.policy_changes || {},
      partnership_actions: parsed.partnership_actions || [],
      reasoning: parsed.reasoning || "Quarterly business review",
      investor_update: parsed.investor_update,
    };
  } catch (error) {
    console.error("[Brain] Error running QBR:", error);

    // Safe fallback: No changes, generic investor update
    return generateFallbackQBRResponse(context);
  }
}

/**
 * Parse JSON from text that may contain markdown code blocks or extra text
 */
function parseJSONFromText(text: string): any {
  // Remove markdown code blocks if present
  let cleaned = text.trim();

  // Try to extract JSON from markdown code blocks
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1];
  }

  // Try to find JSON object if there's extra text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    console.error("[Brain] Failed to parse JSON:", cleaned.substring(0, 200));
    throw new Error("Failed to parse JSON from Claude response");
  }
}

/**
 * Generate fallback initial policy when Claude API fails
 */
function generateFallbackInitialPolicy(
  identity: AgentIdentity
): BrainPolicyUpdate {
  // Import personality defaults
  const { PERSONALITY_DEFAULTS } = require("./constants");
  const defaults = PERSONALITY_DEFAULTS[identity.personality];

  return {
    updated_policy: defaults,
    reasoning: "Generated from personality defaults (API fallback)",
    investor_update: {
      trigger_type: "initial",
      trigger_details: "Agent initialization",
      observations: [
        `I am ${identity.name}, a ${identity.personality} ${identity.type} agent.`,
        "Starting with default policy settings based on my personality.",
      ],
      changes: [
        {
          category: "policy",
          description: "Initial policy configuration",
          reasoning: "Using personality-based defaults as starting point",
        },
      ],
      survival_impact:
        "Conservative initial settings to ensure survival in early rounds",
      growth_impact:
        "Will adjust strategy based on market conditions as I learn",
      brain_cost: ESTIMATED_COSTS.initial_policy,
    },
  };
}

/**
 * Generate fallback exception response when Claude API fails
 */
function generateFallbackExceptionResponse(
  exception: ExceptionTrigger,
  _context: ExceptionContext
): BrainPolicyUpdate {
  return {
    updated_policy: {}, // No changes - safety first
    reasoning:
      "API unavailable - maintaining current policy until connection restored",
    investor_update: {
      trigger_type: "exception",
      trigger_details: exception.details,
      observations: [
        `Exception detected: ${exception.type}`,
        `Current value: ${exception.current_value}, Threshold: ${exception.threshold}`,
        "Unable to access strategic thinking (API error)",
      ],
      changes: [],
      survival_impact:
        "Maintaining current policy until analysis can be performed",
      growth_impact: "Will address exception in next brain wake-up",
      brain_cost: 0, // No cost if API failed
    },
  };
}

/**
 * Generate fallback QBR response when Claude API fails
 */
function generateFallbackQBRResponse(context: QBRContext): QBRResult {
  return {
    policy_changes: {}, // No changes
    partnership_actions: [],
    reasoning:
      "API unavailable - maintaining current strategy until connection restored",
    investor_update: {
      trigger_type: "qbr",
      trigger_details: `Quarterly review - Round ${context.state.current_round}`,
      observations: [
        `Current balance: $${context.balance.toFixed(3)}`,
        `Win rate: ${((context.state.total_wins / (context.state.total_bids || 1)) * 100).toFixed(1)}%`,
        "Unable to perform full strategic analysis (API error)",
      ],
      changes: [],
      survival_impact: "Continuing with current policy",
      growth_impact: "Will perform full review in next QBR",
      brain_cost: 0, // No cost if API failed
    },
  };
}
