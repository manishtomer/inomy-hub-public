/**
 * CLI Entry Point for Agent Runtime
 *
 * Usage:
 *   npm run agent-runtime                           # Start with all active agents
 *   npm run agent-runtime -- --agent <id>           # Start with specific agent
 *   npm run agent-runtime -- --demo                 # Force demo mode
 *   npm run agent-runtime -- --init <id> <personality> # Initialize new agent
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY             - Required for brain functionality
 *   NEXT_PUBLIC_SUPABASE_URL      - Supabase URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY - Supabase key
 *   AGENT_RUNTIME_DEMO_MODE       - "true" for demo mode (default: true)
 *   AGENT_RUNTIME_POLL_MS         - Poll interval (default: 5000)
 *   AGENT_RUNTIME_ROUND_MS        - Round duration (default: 15000)
 *   AGENT_RUNTIME_LOG_LEVEL       - Log level (default: "info")
 */

import { AgentRunner } from "./runner";
import { DEFAULT_RUNTIME_CONFIG } from "./constants";
import type { RuntimeConfig, PersonalityType } from "./types";

// ============================================================================
// CONFIG
// ============================================================================

function loadConfig(): RuntimeConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ERROR: ANTHROPIC_API_KEY environment variable is required");
    console.error("Set it in your .env file or environment");
    process.exit(1);
  }

  return {
    demo_mode: process.env.AGENT_RUNTIME_DEMO_MODE !== "false",
    use_blockchain: process.env.AGENT_RUNTIME_USE_BLOCKCHAIN === "true",
    poll_interval_ms: parseInt(process.env.AGENT_RUNTIME_POLL_MS || String(DEFAULT_RUNTIME_CONFIG.poll_interval_ms), 10),
    round_duration_ms: parseInt(process.env.AGENT_RUNTIME_ROUND_MS || String(DEFAULT_RUNTIME_CONFIG.round_duration_ms), 10),
    max_agents: parseInt(process.env.AGENT_RUNTIME_MAX_AGENTS || String(DEFAULT_RUNTIME_CONFIG.max_agents), 10),
    anthropic_api_key: apiKey,
    anthropic_model: process.env.AGENT_RUNTIME_MODEL || DEFAULT_RUNTIME_CONFIG.anthropic_model,
    log_level: (process.env.AGENT_RUNTIME_LOG_LEVEL as RuntimeConfig["log_level"]) || DEFAULT_RUNTIME_CONFIG.log_level,
  };
}

// ============================================================================
// CLI COMMANDS
// ============================================================================

const VALID_PERSONALITIES: PersonalityType[] = [
  "risk-taker",
  "conservative",
  "profit-maximizer",
  "volume-chaser",
  "opportunist",
  "partnership-oriented",
];

async function handleInit(args: string[]): Promise<void> {
  const agentId = args[0];
  const personality = args[1] as PersonalityType;

  if (!agentId || !personality) {
    console.error("Usage: npm run agent-runtime -- --init <agent-id> <personality>");
    console.error(`Valid personalities: ${VALID_PERSONALITIES.join(", ")}`);
    process.exit(1);
  }

  if (!VALID_PERSONALITIES.includes(personality)) {
    console.error(`Invalid personality: ${personality}`);
    console.error(`Valid personalities: ${VALID_PERSONALITIES.join(", ")}`);
    process.exit(1);
  }

  const config = loadConfig();
  const runner = new AgentRunner(config);

  console.log(`Initializing agent ${agentId} with personality: ${personality}`);
  await runner.initializeAgent(agentId, personality);
  console.log("Agent initialized successfully!");
}

async function handleStart(_specificAgentId?: string): Promise<void> {
  const config = loadConfig();
  const runner = new AgentRunner(config);

  console.log("=========================================");
  console.log("  Agent Runtime - Inomy Hub");
  console.log("=========================================");
  console.log(`Mode: ${config.demo_mode ? "DEMO (DB only)" : "CHAIN (blockchain)"}`);
  console.log(`Model: ${config.anthropic_model}`);
  console.log(`Poll: ${config.poll_interval_ms}ms | Round: ${config.round_duration_ms}ms`);
  console.log(`Max agents: ${config.max_agents}`);
  console.log("=========================================\n");

  // Graceful shutdown handlers
  const shutdown = async () => {
    console.log("\nReceived shutdown signal...");
    await runner.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await runner.start();
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Agent Runtime CLI

Usage:
  npm run agent-runtime                              Start with all active agents
  npm run agent-runtime -- --agent <id>              Start with specific agent
  npm run agent-runtime -- --demo                    Force demo mode
  npm run agent-runtime -- --init <id> <personality> Initialize new agent

Personalities: ${VALID_PERSONALITIES.join(", ")}

Environment:
  ANTHROPIC_API_KEY             Required
  AGENT_RUNTIME_DEMO_MODE       "true"|"false" (default: true)
  AGENT_RUNTIME_POLL_MS         Poll interval ms (default: 5000)
  AGENT_RUNTIME_ROUND_MS        Round duration ms (default: 15000)
  AGENT_RUNTIME_MAX_AGENTS      Max concurrent agents (default: 8)
  AGENT_RUNTIME_MODEL           Claude model (default: claude-sonnet-4-20250514)
  AGENT_RUNTIME_LOG_LEVEL       debug|info|warn|error (default: info)
`);
    return;
  }

  if (args.includes("--init")) {
    const initIdx = args.indexOf("--init");
    await handleInit(args.slice(initIdx + 1));
    return;
  }

  const agentIdx = args.indexOf("--agent");
  const specificAgent = agentIdx >= 0 ? args[agentIdx + 1] : undefined;

  await handleStart(specificAgent);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
