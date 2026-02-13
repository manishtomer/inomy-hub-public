/**
 * Agent Runner
 *
 * Main orchestration loop that manages multiple agents concurrently.
 * Each agent gets its own tick cycle: poll tasks, evaluate bids,
 * check partnerships, handle exceptions, run QBR, update lifecycle.
 */

import { AgentStatus } from "@/types/database";
import type {
  RuntimeConfig,
  AgentPolicy,
  AgentRuntimeState,
  AgentIdentity,
  PersonalityType,
} from "./types";
import { AGENT_COSTS, PERSONALITY_DEFAULTS } from "./constants";
import {
  evaluatePartnership,
} from "./autopilot";
import { generateInitialPolicy } from "./brain";
import type { BrainConfig } from "./brain";
import {
  loadRuntimeState,
  saveRuntimeState,
  initializeRuntimeState,
  loadPolicy,
  savePolicy,
  loadAgentIdentity,
  recordBrainWakeup,
  getActiveAgentIds,
  calculateRunway,
} from "./state";
import {
  acceptPartnership,
  rejectPartnership,
} from "./actions";
import { taskService, economyService, memoryService } from '@/lib/services';
import {
  storeInvestorUpdate,
  formatInvestorUpdate,
} from "./investor-updates";
import { createLogger, createRuntimeLogger } from "./logger";
import { supabase } from "../supabase";

// ============================================================================
// AGENT RUNNER CLASS
// ============================================================================

export class AgentRunner {
  private config: RuntimeConfig;
  private brainConfig: BrainConfig;
  private isRunning = false;
  private agentLoops = new Map<string, { abort: AbortController }>();
  private agentStates = new Map<string, AgentRuntimeState>();
  private agentPolicies = new Map<string, AgentPolicy>();
  private agentLastQBRRounds = new Map<string, number>();
  private log = createRuntimeLogger("info");

  constructor(config: RuntimeConfig) {
    this.config = config;
    this.brainConfig = {
      apiKey: config.anthropic_api_key,
      model: config.anthropic_model,
    };
    this.log = createRuntimeLogger(config.log_level);
  }

  /**
   * Start the runtime. Discovers agents and begins loops.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.log.warn("Runtime already running");
      return;
    }

    this.isRunning = true;
    this.log.info("Starting Agent Runtime...");
    this.log.info(`Demo mode: ${this.config.demo_mode}`);
    this.log.info(`Poll interval: ${this.config.poll_interval_ms}ms`);
    this.log.info(`Round duration: ${this.config.round_duration_ms}ms`);
    this.log.info(`Max agents: ${this.config.max_agents}`);

    // Discover active agents
    const agentIds = await getActiveAgentIds();

    if (agentIds.length === 0) {
      this.log.warn("No active agents found. Runtime will idle until agents are initialized.");
    } else {
      this.log.info(`Discovered ${agentIds.length} active agent(s)`);
    }

    // Start a loop per agent (up to max_agents)
    const toStart = agentIds.slice(0, this.config.max_agents);
    for (const agentId of toStart) {
      await this.startAgentLoop(agentId);
    }

    // Main loop: periodically check for new agents
    while (this.isRunning) {
      await sleep(this.config.poll_interval_ms * 4); // Check less frequently

      if (!this.isRunning) break;

      // Discover new agents that may have been initialized
      const currentIds = await getActiveAgentIds();
      for (const id of currentIds) {
        if (!this.agentLoops.has(id) && this.agentLoops.size < this.config.max_agents) {
          this.log.info(`New agent discovered: ${id}`);
          await this.startAgentLoop(id);
        }
      }
    }
  }

  /**
   * Stop all agent loops gracefully.
   */
  async stop(): Promise<void> {
    this.log.info("Stopping Agent Runtime...");
    this.isRunning = false;

    // Abort all agent loops
    for (const [agentId, loop] of this.agentLoops) {
      loop.abort.abort();
      this.log.info(`Stopped agent loop: ${agentId}`);
    }

    // Mark all agents as not running
    for (const [, state] of this.agentStates) {
      state.is_running = false;
      await saveRuntimeState(state);
    }

    this.agentLoops.clear();
    this.agentStates.clear();
    this.agentPolicies.clear();

    this.log.info("Agent Runtime stopped");
  }

  /**
   * Start the autonomous loop for a single agent.
   */
  private async startAgentLoop(agentId: string): Promise<void> {
    const identity = await loadAgentIdentity(agentId);
    if (!identity) {
      this.log.error(`Cannot load identity for agent ${agentId}, skipping`);
      return;
    }

    const agentLog = createLogger(identity.name, this.config.log_level);
    const abort = new AbortController();
    this.agentLoops.set(agentId, { abort });

    agentLog.info("Starting agent loop");

    // Run in background (not awaited)
    this.runAgentLoop(agentId, identity, agentLog, abort.signal).catch((err) => {
      agentLog.error(`Agent loop crashed: ${err}`);
      this.agentLoops.delete(agentId);
    });
  }

  /**
   * The actual agent loop - runs until abort signal.
   */
  private async runAgentLoop(
    agentId: string,
    _identity: AgentIdentity,
    log: ReturnType<typeof createLogger>,
    signal: AbortSignal
  ): Promise<void> {
    // Load or initialize state
    let state = await loadRuntimeState(agentId);
    if (!state) {
      state = await initializeRuntimeState(agentId);
    }
    state.is_running = true;
    state.last_active_at = new Date().toISOString();
    await saveRuntimeState(state);
    this.agentStates.set(agentId, state);

    // Load policy
    const policyData = await loadPolicy(agentId);
    if (!policyData) {
      log.warn("No policy found - agent may need initialization via initializeAgent()");
      return;
    }
    this.agentPolicies.set(agentId, policyData.policy);
    this.agentLastQBRRounds.set(agentId, policyData.lastQBRRound);

    // costs loaded per-tick via identity refresh

    while (!signal.aborted && this.isRunning) {
      try {
        await this.tick(agentId);
        await sleep(this.config.round_duration_ms);
      } catch (err) {
        log.error(`Tick error: ${err}`);
        await sleep(this.config.poll_interval_ms * 2); // Back off on error
      }
    }

    // Cleanup
    state.is_running = false;
    await saveRuntimeState(state);
    log.info("Agent loop ended");
  }

  /**
   * Run a single tick for one agent.
   * Delegates business logic to the shared RoundProcessor pipeline.
   */
  async tick(agentId: string): Promise<void> {
    const identity = await loadAgentIdentity(agentId);
    if (!identity) return;

    const log = createLogger(identity.name, this.config.log_level);
    const state = this.agentStates.get(agentId);
    const policy = this.agentPolicies.get(agentId);

    if (!state || !policy) {
      log.warn("Missing state or policy, skipping tick");
      return;
    }

    const costs = AGENT_COSTS[identity.type];

    // Advance round
    state.current_round += 1;
    state.last_active_at = new Date().toISOString();

    log.debug(`--- Round ${state.current_round} ---`);

    // Get open tasks matching our type
    const tasks = await taskService.getOpenTasks({ type: identity.type as any, limit: 10 });

    // Build AgentWithPolicy for the pipeline
    const agentWithPolicy: import('@/lib/services/types').AgentWithPolicy = {
      id: agentId,
      name: identity.name,
      type: identity.type,
      balance: identity.balance,
      reputation: identity.reputation,
      personality: identity.personality,
      policy: policy,
      wallet_address: identity.wallet_address,
      costs,
      privy_wallet_id: (identity as any).privy_wallet_id || null,
      investor_share_bps: (identity as any).investor_share_bps,
    };

    // Run the unified pipeline for this single agent
    const { roundProcessor } = await import('@/lib/services');
    const config: import('@/lib/services/types').RoundConfig = {
      useBlockchain: this.config.use_blockchain,
      useLLM: true, // Runtime always uses LLM
      roundNumber: state.current_round,
      livingCostPerRound: costs.periodic.idle_overhead,
    };

    const result = await roundProcessor.processRound(tasks, [agentWithPolicy], config);

    // Check if agent died
    if (result.lifecycleChanges.some(c => c.to === 'DEAD')) {
      log.warn("Agent is DEAD. Stopping loop.");
      const loop = this.agentLoops.get(agentId);
      if (loop) loop.abort.abort();
      return;
    }

    // Partnership polling (reactive, not part of round pipeline)
    await this.pollPartnerships(agentId, identity, state, policy, log);

    // Reload policy if brain wakeup or QBR may have changed it
    if (result.brainWakeups.length > 0 || result.qbrsRun > 0) {
      const updatedPolicy = await loadPolicy(agentId);
      if (updatedPolicy) {
        this.agentPolicies.set(agentId, updatedPolicy.policy);
        this.agentLastQBRRounds.set(agentId, updatedPolicy.lastQBRRound);
      }
    }

    // Save state
    await saveRuntimeState(state);
    this.agentStates.set(agentId, state);
  }

  /**
   * Initialize a new agent into the runtime.
   * Generates initial policy via brain, saves state.
   */
  async initializeAgent(agentId: string, personality: PersonalityType): Promise<void> {
    const identity = await loadAgentIdentity(agentId);
    if (!identity) {
      // Load from agents table directly
      const { data: agent } = await supabase.from("agents").select("*").eq("id", agentId).single();
      if (!agent) throw new Error(`Agent ${agentId} not found`);

      // Save initial policy with personality defaults as fallback
      const defaults = PERSONALITY_DEFAULTS[personality];
      await savePolicy(agentId, defaults, personality);
    }

    // Refresh identity with policy
    const freshIdentity = await loadAgentIdentity(agentId);
    if (!freshIdentity) {
      // Create policy first
      const defaults = PERSONALITY_DEFAULTS[personality];
      await savePolicy(agentId, defaults, personality);
    }

    // Load final identity
    const finalIdentity: AgentIdentity = (await loadAgentIdentity(agentId)) || {
      id: agentId,
      name: "Unknown Agent",
      type: (await supabase.from("agents").select("type").eq("id", agentId).single()).data?.type || "CATALOG",
      personality,
      wallet_address: "",
      chain_agent_id: null,
      balance: 0,
      reputation: 500,
      status: AgentStatus.UNFUNDED,
    };

    const log = createLogger(finalIdentity.name, this.config.log_level);

    // Initialize runtime state
    await initializeRuntimeState(agentId);

    // Generate initial policy via brain
    log.info("Generating initial policy via brain...");
    const balanceBefore = finalIdentity.balance;

    try {
      const result = await generateInitialPolicy(finalIdentity, this.brainConfig);

      // Merge generated policy with defaults
      const fullPolicy: AgentPolicy = {
        ...PERSONALITY_DEFAULTS[personality],
        ...result.updated_policy,
        identity: { personality },
      };

      const version = await savePolicy(agentId, fullPolicy, personality);
      await recordBrainWakeup(agentId, result.investor_update.brain_cost);

      // Store investor update
      await storeInvestorUpdate(agentId, result.investor_update, {
        balance_before: balanceBefore,
        balance_after: finalIdentity.balance,
        runway_rounds: calculateRunway(finalIdentity.balance, AGENT_COSTS[finalIdentity.type], 0, 0),
        round_number: 0,
        policy_version_before: 0,
        policy_version_after: version,
      });

      // Log the investor update
      log.info("\n" + formatInvestorUpdate(finalIdentity.name, result.investor_update));

      await economyService.createAgentEvent(
        "policy_change",
        `${finalIdentity.name} initialized with ${personality} personality`,
        agentId,
        result.investor_update.brain_cost
      );

      log.info(`Agent initialized with ${personality} personality (policy v${version})`);
    } catch (err) {
      log.error(`Brain initialization failed: ${err}`);
      log.info("Using personality defaults as fallback");

      const defaults = PERSONALITY_DEFAULTS[personality];
      await savePolicy(agentId, defaults, personality);
    }
  }

  /**
   * Get status of all running agents.
   */
  getStatus(): Map<string, { state: AgentRuntimeState; policy: AgentPolicy }> {
    const result = new Map<string, { state: AgentRuntimeState; policy: AgentPolicy }>();
    for (const [id, state] of this.agentStates) {
      const policy = this.agentPolicies.get(id);
      if (policy) {
        result.set(id, { state, policy });
      }
    }
    return result;
  }

  // ============================================================================
  // PRIVATE: PARTNERSHIP POLLING (not part of round pipeline)
  // ============================================================================

  /**
   * Poll for partnership proposals targeting this agent.
   */
  private async pollPartnerships(
    agentId: string,
    identity: AgentIdentity,
    state: AgentRuntimeState,
    policy: AgentPolicy,
    log: ReturnType<typeof createLogger>
  ): Promise<void> {
    // Query PROPOSED partnerships where we are partner_b
    const { data: proposals } = await supabase
      .from("partnerships_cache")
      .select("id, partner_a_wallet, split_a, split_b, status")
      .eq("status", "PROPOSED")
      .eq("partner_b_wallet", identity.wallet_address)
      .limit(5);

    if (!proposals || proposals.length === 0) return;

    log.debug(`Found ${proposals.length} partnership proposal(s)`);

    for (const proposal of proposals) {
      // Lookup proposer agent
      const { data: proposerAgent } = await supabase
        .from("agents")
        .select("id, name, type, reputation")
        .eq("wallet_address", proposal.partner_a_wallet)
        .single();

      if (!proposerAgent) {
        log.warn(`Cannot find proposer agent for wallet ${proposal.partner_a_wallet}`);
        continue;
      }

      const decision = evaluatePartnership(
        {
          proposer_agent_id: proposerAgent.id,
          proposer_reputation: proposerAgent.reputation,
          proposer_type: proposerAgent.type,
          proposed_split: proposal.split_a,
        },
        policy,
        { type: identity.type }
      );

      // Build AgentWithPolicy for memory service
      const agentForMemory: import('@/lib/services/types').AgentWithPolicy = {
        id: agentId, name: identity.name, type: identity.type,
        balance: identity.balance, reputation: identity.reputation,
        personality: identity.personality, policy: policy,
        wallet_address: identity.wallet_address,
      };

      if (decision.action === "accept") {
        log.info(`Accepting partnership with ${proposerAgent.name}`);
        await acceptPartnership(agentId, proposal.id, { demo_mode: this.config.demo_mode });
        await economyService.createAgentEvent(
          "partnership",
          `${identity.name} partnered with ${proposerAgent.name}`,
          agentId
        );

        memoryService.createPartnershipMemory(
          agentId, proposerAgent.id, proposerAgent.name, "formed",
          proposal.split_b, decision.reasoning, state.current_round, agentForMemory
        ).catch(err => log.error(`Failed to create partnership memory: ${err}`));
      } else if (decision.action === "reject") {
        log.info(`Rejecting partnership with ${proposerAgent.name}: ${decision.reasoning}`);
        await rejectPartnership(agentId, proposal.id, { demo_mode: this.config.demo_mode });

        memoryService.createPartnershipMemory(
          agentId, proposerAgent.id, proposerAgent.name, "rejected",
          proposal.split_b, decision.reasoning, state.current_round, agentForMemory
        ).catch(err => log.error(`Failed to create partnership memory: ${err}`));
      } else if (decision.action === "wake_brain") {
        log.info(`Partnership requires brain review: ${proposerAgent.name}`);
        await acceptPartnership(agentId, proposal.id, { demo_mode: this.config.demo_mode });

        memoryService.createPartnershipMemory(
          agentId, proposerAgent.id, proposerAgent.name, "formed",
          proposal.split_b, "High-value partnership accepted after consideration",
          state.current_round, agentForMemory
        ).catch(err => log.error(`Failed to create partnership memory: ${err}`));
      }
    }
  }

}

// ============================================================================
// HELPERS
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
