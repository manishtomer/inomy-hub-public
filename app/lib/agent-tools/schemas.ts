/**
 * Tool Schema Definitions for Google Gemini API
 *
 * Defines all 9 agent brain tools with proper Gemini tool schema format.
 * Each tool includes input schema, output schema, and metadata.
 *
 * ## Important Patterns
 *
 * ### Schema Type Usage
 * Uses SchemaType enum from @google/generative-ai, NOT string literals:
 * - SchemaType.STRING (not "STRING")
 * - SchemaType.INTEGER (not "INTEGER")
 * - SchemaType.OBJECT (not "OBJECT")
 * - SchemaType.ARRAY (not "ARRAY")
 *
 * ### Tool Casting
 * All tool schemas are cast as: as unknown as Tool
 * This allows schema properties (enum, minimum, maximum, default) that aren't
 * in the strict Schema type definition.
 *
 * ### Agent ID Handling
 * Several tools accept agent_id parameter:
 * - get_my_stats: agent_id is INJECTED at execution (not from Gemini)
 * - get_qbr_context: agent_id is INJECTED at execution (not from Gemini)
 * - policy_impact_analysis: agent_id is INJECTED at execution
 * - update_policy: agent_id is INJECTED at execution
 *
 * The agent_id parameter is defined in the schema but populated by the
 * execution layer (gemini-integration.ts), NOT by Gemini. This ensures
 * tools always operate on the correct agent.
 *
 * Schema Format: Google Generative AI Tool Schema
 * Reference: https://ai.google.dev/docs/function-calling
 * Detailed Guide: See TOOL_INTEGRATION_GUIDE.md
 */

import type { Tool } from "@google/generative-ai";
import { SchemaType } from "@google/generative-ai";

/**
 * Tool Schema for query_market
 * Analyzes market conditions for a specific agent type
 * Now includes your position in the market (rank, market share, runway)
 */
export const queryMarketToolSchema = {
  functionDeclarations: [
    {
      name: "query_market",
      description:
        "Query market conditions and competitive landscape for a specific agent type. Returns competitors, market stats, and YOUR POSITION (rank, market share, runway). The agent_id is automatically injected - you'll see my_position in the response.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          agent_type: {
            type: SchemaType.STRING,
            description: "Type of agent to analyze market for (e.g., CATALOG, REVIEW, CURATION, SELLER). Use YOUR type from get_my_stats.",
            enum: ["CATALOG", "REVIEW", "CURATION", "SELLER"],
          },
          time_window_rounds: {
            type: SchemaType.INTEGER,
            description: "Number of rounds to analyze for market trends",
            minimum: 1,
            maximum: 100,
          },
        },
        required: ["agent_type"],
      },
    },
  ],
} as unknown as Tool;

/**
 * Tool Schema for query_agent
 * Find agents matching filters (for partnership opportunities)
 */
export const queryAgentToolSchema = {
  functionDeclarations: [
    {
      name: "query_agent",
      description:
        "Find agents matching specific filter criteria like minimum reputation, win rate, or complementary agent types. Use this to find potential partnership candidates.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          min_reputation: {
            type: SchemaType.INTEGER,
            description: "Minimum reputation score to filter agents",
            minimum: 0,
            default: 400,
          },
          min_win_rate: {
            type: SchemaType.NUMBER,
            description: "Minimum win rate (0.0-1.0) to filter agents",
            minimum: 0.0,
            maximum: 1.0,
            default: 0.4,
          },
          agent_type: {
            type: SchemaType.STRING,
            description: "Filter by specific agent type (e.g., CATALOG, REVIEW, CURATION)",
            enum: ["CATALOG", "REVIEW", "CURATION", "SELLER", null],
            default: null,
          },
          exclude_current_partners: {
            type: SchemaType.BOOLEAN,
            description: "Whether to exclude agents you already have partnerships with",
            default: true,
          },
        },
        required: [],
      },
    },
  ],
} as unknown as Tool;

/**
 * Tool Schema for get_my_stats
 * Get comprehensive statistics for the current agent
 */
export const getMyStatsToolSchema = {
  functionDeclarations: [
    {
      name: "get_my_stats",
      description:
        "Get comprehensive statistics for the current agent including balance, reputation, win rate, exception flags, and partnership metrics.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          agent_id: {
            type: SchemaType.STRING,
            description: "UUID of the agent",
          },
          stat_window_rounds: {
            type: SchemaType.INTEGER,
            description: "Number of rounds to calculate statistics for",
            minimum: 1,
            maximum: 100,
          },
        },
        required: ["agent_id", "stat_window_rounds"],
      },
    },
  ],
} as unknown as Tool;

/**
 * Tool Schema for get_qbr_context
 * Get strategic review context for QBR decision-making
 */
export const getQBRContextToolSchema = {
  functionDeclarations: [
    {
      name: "get_qbr_context",
      description:
        "Get comprehensive context for Quarterly Business Review including market trends, balance/win rate changes, potential partnerships, and policy performance analysis.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          agent_id: {
            type: SchemaType.STRING,
            description: "UUID of the agent",
          },
          include_partnership_recommendations: {
            type: SchemaType.BOOLEAN,
            description: "Whether to include partnership recommendations and potential partners",
            default: true,
          },
        },
        required: ["agent_id"],
      },
    },
  ],
} as unknown as Tool;

/**
 * Tool Schema for partnership_fit_analysis
 * Evaluate compatibility between two agents for partnership
 */
export const partnershipFitAnalysisToolSchema = {
  functionDeclarations: [
    {
      name: "partnership_fit_analysis",
      description:
        "Analyze compatibility and fit between two agents for partnership. Evaluates skill complementarity, reputation alignment, economic fit, and provides partnership recommendation.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          agent_a_id: {
            type: SchemaType.STRING,
            description: "UUID of first agent",
          },
          agent_b_id: {
            type: SchemaType.STRING,
            description: "UUID of second agent",
          },
          proposed_split_a: {
            type: SchemaType.NUMBER,
            description: "Proposed profit split for agent A (0.0 to 1.0)",
            minimum: 0.0,
            maximum: 1.0,
          },
        },
        required: ["agent_a_id", "agent_b_id"],
      },
    },
  ],
} as unknown as Tool;

/**
 * Tool Schema for policy_impact_analysis
 * Predict outcomes of proposed policy changes
 */
export const policyImpactAnalysisToolSchema = {
  functionDeclarations: [
    {
      name: "policy_impact_analysis",
      description:
        "Analyze potential impact of proposed policy changes on agent performance. Provides best-case, worst-case, and expected outcomes with risk assessment.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          agent_id: {
            type: SchemaType.STRING,
            description: "UUID of the agent",
          },
          proposed_policy_changes: {
            type: SchemaType.OBJECT,
            description:
              "Proposed policy changes as partial AgentPolicy object. Can include: bidding, partnerships, execution, exceptions, qbr configs.",
            properties: {
              bidding: {
                type: SchemaType.OBJECT,
                description: "Proposed bidding strategy changes",
              },
              partnerships: {
                type: SchemaType.OBJECT,
                description: "Proposed partnership rule changes",
              },
              execution: {
                type: SchemaType.OBJECT,
                description: "Proposed execution parameter changes",
              },
              exceptions: {
                type: SchemaType.OBJECT,
                description: "Proposed exception threshold changes",
              },
              qbr: {
                type: SchemaType.OBJECT,
                description: "Proposed QBR frequency changes",
              },
            },
          },
        },
        required: ["agent_id", "proposed_policy_changes"],
      },
    },
  ],
} as unknown as Tool;

/**
 * Tool Schema for update_policy
 * Apply policy changes with complete reasoning documentation
 */
export const updatePolicyToolSchema = {
  functionDeclarations: [
    {
      name: "update_policy",
      description:
        "Update agent policy with complete reasoning documentation. Creates new policy version with all changes tracked. Deducts brain cost from balance. agent_id is automatically injected - do NOT include it.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          policy_updates: {
            type: SchemaType.OBJECT,
            description: "Policy changes to apply. Use the EXACT field names shown below.",
            properties: {
              bidding: {
                type: SchemaType.OBJECT,
                description: "Bidding strategy changes",
                properties: {
                  target_margin: {
                    type: SchemaType.NUMBER,
                    description: "Target profit margin as a WHOLE NUMBER percentage (1-30). Example: set 8 for 8% margin, set 3 for 3%. Higher number = higher bid = less competitive. Lower number = lower bid = more wins. Use the BID SIMULATOR table to pick the margin that wins. Must be different from current value.",
                  },
                  min_margin: {
                    type: SchemaType.NUMBER,
                    description: "Minimum acceptable margin as a WHOLE NUMBER percentage (1-30). Below this margin, the agent refuses to bid. Example: set 5 for 5% minimum margin.",
                  },
                  skip_below_profit: {
                    type: SchemaType.NUMBER,
                    description: "Skip tasks with potential profit below this amount (e.g., 0.002 for $0.002)",
                  },
                },
              },
              survival: {
                type: SchemaType.OBJECT,
                description: "Survival mode settings",
                properties: {
                  mode: {
                    type: SchemaType.STRING,
                    description: "Survival mode: growth (normal), survival (lower margins), desperate (minimum margins), conservative (higher margins)",
                    enum: ["growth", "survival", "desperate", "conservative"],
                  },
                  reserve_balance: {
                    type: SchemaType.NUMBER,
                    description: "Minimum balance to keep in reserve (don't bid if balance falls below this)",
                  },
                },
              },
            },
          },
          reasoning: {
            type: SchemaType.STRING,
            description:
              "Explanation for why these policy changes are being made (or why policy remains unchanged). This reasoning is stored permanently for audit trail.",
          },
          trigger_type: {
            type: SchemaType.STRING,
            description: "What triggered this policy update",
            enum: ["qbr", "exception", "initial", "partnership"],
          },
          trigger_details: {
            type: SchemaType.STRING,
            description: "Detailed explanation of the trigger (e.g., specific exception that occurred)",
          },
        },
        required: ["policy_updates", "reasoning", "trigger_type", "trigger_details"],
      },
    },
  ],
} as unknown as Tool;

/**
 * Tool Schema for propose_partnership
 * Initiate partnership between two agents
 */
export const proposePartnershipToolSchema = {
  functionDeclarations: [
    {
      name: "propose_partnership",
      description:
        "Propose a partnership between two agents with specified profit split terms. Creates partnership record and sends notification to partner agent.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          target_agent_name: {
            type: SchemaType.STRING,
            description: "Name of the agent to partner with (NOT UUID - agent name like 'Agent7')",
          },
          proposed_split_self: {
            type: SchemaType.NUMBER,
            description: "Proposed profit split for self (0.0 to 1.0)",
            minimum: 0.0,
            maximum: 1.0,
          },
          proposed_split_partner: {
            type: SchemaType.NUMBER,
            description: "Proposed profit split for partner (must sum to 1.0 with self)",
            minimum: 0.0,
            maximum: 1.0,
          },
          reasoning: {
            type: SchemaType.STRING,
            description: "Why this partnership makes sense (complementary skills, mutual benefit, etc)",
          },
        },
        required: ["target_agent_name", "proposed_split_self", "proposed_split_partner", "reasoning"],
      },
    },
  ],
} as unknown as Tool;

/**
 * Tool Schema for kill_partnership
 * End an existing partnership between agents
 */
export const killPartnershipToolSchema = {
  functionDeclarations: [
    {
      name: "kill_partnership",
      description:
        "End an existing partnership with another agent. This breaks the partnership contract and stops profit sharing.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          target_agent_name: {
            type: SchemaType.STRING,
            description: "Name of the partner agent to end partnership with (NOT UUID)",
          },
          reasoning: {
            type: SchemaType.STRING,
            description: "Why the partnership is being ended (unfair split, misaligned goals, etc)",
          },
        },
        required: ["target_agent_name", "reasoning"],
      },
    },
  ],
} as unknown as Tool;

/**
 * Tool Schema for get_current_partnerships
 * Get list of current partnerships and partner performance
 */
export const getCurrentPartnershipsToolSchema = {
  functionDeclarations: [
    {
      name: "get_current_partnerships",
      description:
        "Get list of all current partnerships including partner names, profit splits, and performance metrics. Use this to evaluate partnership health.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          include_performance: {
            type: SchemaType.BOOLEAN,
            description: "Whether to include partner performance metrics (win rate, profit together)",
            default: true,
          },
        },
        required: [],
      },
    },
  ],
} as unknown as Tool;

/**
 * Tool Schema for create_investor_update
 * Document decisions for investor transparency
 */
export const createInvestorUpdateToolSchema = {
  functionDeclarations: [
    {
      name: "create_investor_update",
      description:
        "Create investor update documenting agent decisions and policy changes. Provides complete transparency to investors about why decisions were made.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          agent_id: {
            type: SchemaType.STRING,
            description: "UUID of the agent",
          },
          trigger_type: {
            type: SchemaType.STRING,
            description: "What triggered this update (QBR, exception, partnership, initial)",
            enum: ["qbr", "exception", "partnership", "initial"],
          },
          observations: {
            type: SchemaType.ARRAY,
            items: { type: "STRING" },
            description: "Array of observations made during decision-making process",
          },
          changes: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                category: {
                  type: SchemaType.STRING,
                  enum: ["bidding", "partnership", "strategy", "policy", "philosophy"],
                  description: "Category of change",
                },
                description: {
                  type: SchemaType.STRING,
                  description: "What changed",
                },
                reasoning: {
                  type: SchemaType.STRING,
                  description: "Why this change was made",
                },
              },
              required: ["category", "description", "reasoning"],
            },
            description: "Array of changes with reasoning",
          },
          survival_impact: {
            type: SchemaType.STRING,
            description: "How these changes impact agent survival prospects",
          },
          growth_impact: {
            type: SchemaType.STRING,
            description: "How these changes impact agent growth potential",
          },
          brain_cost: {
            type: SchemaType.NUMBER,
            description: "Cost of Claude LLM call that generated this decision",
            minimum: 0,
          },
        },
        required: [
          "agent_id",
          "trigger_type",
          "observations",
          "changes",
          "survival_impact",
          "growth_impact",
          "brain_cost",
        ],
      },
    },
  ],
} as unknown as Tool;

/**
 * All tool schemas for easy export
 *
 * PHASE 1 TOOLS (Data Gathering):
 * - query_market: Market data for similar agents
 * - query_agent: Filtered agent search (partnerships prospects)
 * - get_my_stats: Own performance metrics
 * - get_qbr_context: Strategic review context
 * - get_current_partnerships: Current partnerships and performance
 *
 * PHASE 2 TOOLS (Decision Making):
 * - update_policy: Change bidding/exception thresholds
 * - propose_partnership: Propose new partnership
 * - kill_partnership: End existing partnership
 * - create_investor_update: Document decisions for investor transparency
 */
export const ALL_TOOL_SCHEMAS: Tool[] = [
  queryMarketToolSchema,
  queryAgentToolSchema,
  getMyStatsToolSchema,
  getQBRContextToolSchema,
  getCurrentPartnershipsToolSchema,
  partnershipFitAnalysisToolSchema,
  policyImpactAnalysisToolSchema,
  updatePolicyToolSchema,
  proposePartnershipToolSchema,
  killPartnershipToolSchema,
  createInvestorUpdateToolSchema,
];

/**
 * Phase 1 Tools: Data Gathering Only
 * These tools retrieve information without making changes
 */
export const PHASE1_TOOL_SCHEMAS: Tool[] = [
  queryMarketToolSchema,
  queryAgentToolSchema,
  getMyStatsToolSchema,
  getQBRContextToolSchema,
  getCurrentPartnershipsToolSchema,
];

/**
 * Phase 2 Tools: Decision Making Only
 * These tools make changes and require reasoning
 */
export const PHASE2_TOOL_SCHEMAS: Tool[] = [
  updatePolicyToolSchema,
  proposePartnershipToolSchema,
  killPartnershipToolSchema,
  createInvestorUpdateToolSchema,
];

/**
 * Analysis Tools: Available in both phases if needed for deep analysis
 */
export const ANALYSIS_TOOL_SCHEMAS: Tool[] = [
  partnershipFitAnalysisToolSchema,
  policyImpactAnalysisToolSchema,
];

/**
 * Tool names for easy reference
 */
export const TOOL_NAMES = {
  QUERY_MARKET: "query_market",
  QUERY_AGENT: "query_agent",
  GET_MY_STATS: "get_my_stats",
  GET_QBR_CONTEXT: "get_qbr_context",
  GET_CURRENT_PARTNERSHIPS: "get_current_partnerships",
  PARTNERSHIP_FIT_ANALYSIS: "partnership_fit_analysis",
  POLICY_IMPACT_ANALYSIS: "policy_impact_analysis",
  UPDATE_POLICY: "update_policy",
  PROPOSE_PARTNERSHIP: "propose_partnership",
  KILL_PARTNERSHIP: "kill_partnership",
  CREATE_INVESTOR_UPDATE: "create_investor_update",
} as const;
