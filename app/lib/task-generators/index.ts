/**
 * Task Generators
 *
 * Three generators that create tasks for agents to bid on:
 *
 * 1. Steady-State: Constant flow, even distribution, predictable prices
 * 2. Market Waves: Oscillating demand with price fluctuations
 * 3. Scenario: Pre-defined scenarios (bull, bear, type shortage, gold rush)
 *
 * All generators insert tasks into the `tasks` table with status=OPEN.
 * The agent runtime autopilot picks them up and evaluates bids.
 */

import { supabase } from "../supabase";
import { TaskType } from "@/types/database";

// ============================================================================
// SHARED HELPERS
// ============================================================================

/** Per-task cost baselines by type (from agent-runtime/constants.ts) */
const TASK_COST_BASELINES: Record<string, number> = {
  CATALOG: 0.057,  // 0.03 + 0.02 + 0.005 + 0.002
  REVIEW: 0.072,   // 0.04 + 0.025 + 0.005 + 0.002
  CURATION: 0.067, // 0.05 + 0.01 + 0.005 + 0.002
};

const TASK_TYPES = [TaskType.CATALOG, TaskType.REVIEW, TaskType.CURATION];

/** Random float between min and max */
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Pick a random element from an array */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Generate a plausible input_ref for a task type */
function generateInputRef(type: TaskType): string {
  const refs: Record<string, string[]> = {
    CATALOG: [
      "product:electronics:wireless-earbuds-2026",
      "product:fashion:summer-dress-collection",
      "product:home:smart-thermostat-v3",
      "product:food:organic-protein-bars",
      "product:toys:educational-stem-kit",
      "product:beauty:anti-aging-serum",
      "product:sports:carbon-fiber-bike-frame",
      "product:tech:usb-c-hub-12-port",
    ],
    REVIEW: [
      "review:product:noise-cancelling-headphones",
      "review:service:meal-delivery-comparison",
      "review:product:standing-desk-roundup",
      "review:product:robot-vacuum-2026",
      "review:service:cloud-storage-providers",
      "review:product:espresso-machines-under-500",
      "review:product:gaming-laptop-comparison",
      "review:service:vpn-speed-test",
    ],
    CURATION: [
      "curate:gift-guide:fathers-day-2026",
      "curate:collection:home-office-essentials",
      "curate:list:best-budget-smartphones",
      "curate:guide:camping-gear-beginners",
      "curate:collection:sustainable-fashion-brands",
      "curate:list:kitchen-gadgets-under-50",
      "curate:guide:travel-accessories-2026",
      "curate:collection:fitness-tracker-comparison",
    ],
  };
  return pick(refs[type] || refs.CATALOG);
}

/** Insert a task into the database */
async function createTask(
  type: TaskType,
  maxBid: number,
  deadlineMinutes: number = 30
): Promise<string | null> {
  const deadline = new Date(Date.now() + deadlineMinutes * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      type,
      input_ref: generateInputRef(type),
      max_bid: Math.round(maxBid * 1000) / 1000, // 3 decimal places
      deadline,
      status: "OPEN",
      consumer_address: null,
      assigned_agent_id: null,
      winning_bid_id: null,
      metadata_uri: null,
      completed_at: null,
      last_synced_block: 0,
    })
    .select("id")
    .single();

  if (error) {
    console.error(`[TaskGen] Error creating ${type} task:`, error.message);
    return null;
  }

  return data?.id || null;
}

// ============================================================================
// 1. STEADY-STATE GENERATOR
// ============================================================================

export interface SteadyStateConfig {
  /** Tasks per round (default: 3 - one per type) */
  tasks_per_round: number;
  /** Milliseconds between rounds (default: 15000) */
  interval_ms: number;
  /** Price multiplier range: max_bid = cost * multiplier (default: [1.2, 2.0]) */
  price_range: [number, number];
  /** Task deadline in minutes (default: 30) */
  deadline_minutes: number;
}

const STEADY_STATE_DEFAULTS: SteadyStateConfig = {
  tasks_per_round: 3,
  interval_ms: 15000,
  price_range: [1.2, 2.0],
  deadline_minutes: 30,
};

/**
 * Steady-State Generator
 *
 * Creates a constant flow of tasks with even type distribution.
 * Prices hover around profitable levels (1.2x-2.0x cost baseline).
 * Good for baseline testing and stable agent behavior.
 */
export class SteadyStateGenerator {
  private config: SteadyStateConfig;
  private running = false;
  private round = 0;

  constructor(config: Partial<SteadyStateConfig> = {}) {
    this.config = { ...STEADY_STATE_DEFAULTS, ...config };
  }

  async start(): Promise<void> {
    this.running = true;
    console.log("[SteadyState] Starting task generator");
    console.log(`[SteadyState] ${this.config.tasks_per_round} tasks/round, ${this.config.interval_ms}ms interval`);
    console.log(`[SteadyState] Price range: ${this.config.price_range[0]}x-${this.config.price_range[1]}x cost`);

    while (this.running) {
      this.round++;
      await this.generateRound();
      await sleep(this.config.interval_ms);
    }
  }

  stop(): void {
    this.running = false;
    console.log("[SteadyState] Stopped");
  }

  async generateRound(): Promise<void> {
    const tasks: string[] = [];

    for (let i = 0; i < this.config.tasks_per_round; i++) {
      const type = TASK_TYPES[i % TASK_TYPES.length];
      const maxBid = 2.0;

      const id = await createTask(type, maxBid, this.config.deadline_minutes);
      if (id) tasks.push(`${type}:$${maxBid.toFixed(3)}`);
    }

    console.log(`[SteadyState] Round ${this.round}: ${tasks.join(", ")}`);
  }
}

// ============================================================================
// 2. MARKET WAVES GENERATOR
// ============================================================================

export interface MarketWavesConfig {
  /** Base tasks per round (default: 2) */
  base_tasks: number;
  /** Peak tasks per round during high demand (default: 6) */
  peak_tasks: number;
  /** Wave period in rounds (default: 20) */
  wave_period: number;
  /** Milliseconds between rounds (default: 15000) */
  interval_ms: number;
  /** Price volatility: how much prices swing (default: 0.4 = 40%) */
  price_volatility: number;
  /** Chance of a price spike per round (default: 0.05 = 5%) */
  spike_chance: number;
  /** Deadline in minutes (default: 30) */
  deadline_minutes: number;
}

const MARKET_WAVES_DEFAULTS: MarketWavesConfig = {
  base_tasks: 2,
  peak_tasks: 6,
  wave_period: 20,
  interval_ms: 15000,
  price_volatility: 0.4,
  spike_chance: 0.05,
  deadline_minutes: 30,
};

/**
 * Market Waves Generator
 *
 * Simulates realistic market dynamics:
 * - Demand oscillates sinusoidally (boom/bust cycles)
 * - Prices fluctuate with volatility parameter
 * - Occasional price spikes (gold rush moments)
 * - Type distribution shifts over time
 *
 * Tests how agents adapt their bidding strategy to changing conditions.
 */
export class MarketWavesGenerator {
  private config: MarketWavesConfig;
  private running = false;
  private round = 0;

  constructor(config: Partial<MarketWavesConfig> = {}) {
    this.config = { ...MARKET_WAVES_DEFAULTS, ...config };
  }

  async start(): Promise<void> {
    this.running = true;
    console.log("[MarketWaves] Starting task generator");
    console.log(`[MarketWaves] Base: ${this.config.base_tasks}, Peak: ${this.config.peak_tasks}, Period: ${this.config.wave_period} rounds`);

    while (this.running) {
      this.round++;
      await this.generateRound();
      await sleep(this.config.interval_ms);
    }
  }

  stop(): void {
    this.running = false;
    console.log("[MarketWaves] Stopped");
  }

  async generateRound(): Promise<void> {
    // Sinusoidal demand curve
    const phase = (this.round / this.config.wave_period) * 2 * Math.PI;
    const demandFactor = (Math.sin(phase) + 1) / 2; // 0 to 1
    const taskCount = Math.round(
      this.config.base_tasks + demandFactor * (this.config.peak_tasks - this.config.base_tasks)
    );

    // Type distribution shifts: dominant type rotates over time
    const dominantTypeIndex = Math.floor(this.round / this.config.wave_period) % TASK_TYPES.length;

    // Check for spike
    const isSpike = Math.random() < this.config.spike_chance;

    const tasks: string[] = [];

    for (let i = 0; i < taskCount; i++) {
      // 60% chance of dominant type, 40% random
      const type = Math.random() < 0.6
        ? TASK_TYPES[dominantTypeIndex]
        : pick(TASK_TYPES);

      const maxBid = 2.0;

      const id = await createTask(type, maxBid, this.config.deadline_minutes);
      if (id) tasks.push(`${type}:$${maxBid.toFixed(3)}`);
    }

    const demandLabel = demandFactor > 0.7 ? "HIGH" : demandFactor > 0.3 ? "MED" : "LOW";
    const spikeLabel = isSpike ? " [SPIKE!]" : "";
    console.log(`[MarketWaves] Round ${this.round} (${demandLabel}${spikeLabel}): ${tasks.join(", ")}`);
  }
}

// ============================================================================
// 3. SCENARIO GENERATOR
// ============================================================================

export type ScenarioType =
  | "bull_market"      // High demand, high prices, lots of profit opportunities
  | "bear_market"      // Low demand, low prices, survival mode
  | "catalog_shortage" // Few CATALOG tasks → CATALOG agents struggle
  | "review_boom"      // Tons of REVIEW tasks → REVIEW agents thrive
  | "race_to_bottom"   // Many tasks but very low max_bids
  | "gold_rush"        // Few very high-value tasks → intense competition
  | "mixed";           // Random mix of scenarios that changes every N rounds

export interface ScenarioConfig {
  /** Which scenario to run (default: "mixed") */
  scenario: ScenarioType;
  /** Milliseconds between rounds (default: 15000) */
  interval_ms: number;
  /** How many rounds per sub-scenario in mixed mode (default: 10) */
  mixed_switch_rounds: number;
  /** Deadline in minutes (default: 30) */
  deadline_minutes: number;
}

const SCENARIO_DEFAULTS: ScenarioConfig = {
  scenario: "mixed",
  interval_ms: 15000,
  mixed_switch_rounds: 10,
  deadline_minutes: 30,
};

/**
 * Scenario Generator
 *
 * Pre-defined market scenarios that test specific agent behaviors:
 *
 * - bull_market: High volume, generous prices (tests growth strategies)
 * - bear_market: Low volume, tight prices (tests survival strategies)
 * - catalog_shortage: Starves CATALOG agents (tests type-specific adaptation)
 * - review_boom: Floods REVIEW tasks (tests volume-chasers)
 * - race_to_bottom: Low prices across the board (tests min_margin behavior)
 * - gold_rush: Few tasks with huge payoffs (tests competitive bidding)
 * - mixed: Rotates through scenarios to test adaptation
 */
export class ScenarioGenerator {
  private config: ScenarioConfig;
  private running = false;
  private round = 0;
  private currentScenario: ScenarioType;

  constructor(config: Partial<ScenarioConfig> = {}) {
    this.config = { ...SCENARIO_DEFAULTS, ...config };
    this.currentScenario = this.config.scenario === "mixed"
      ? "bull_market"
      : this.config.scenario;
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[Scenario] Starting task generator: ${this.config.scenario}`);

    while (this.running) {
      this.round++;

      // Switch scenario in mixed mode
      if (this.config.scenario === "mixed" && this.round % this.config.mixed_switch_rounds === 1) {
        this.currentScenario = this.pickNextScenario();
        console.log(`\n[Scenario] === Switching to: ${this.currentScenario.toUpperCase()} ===\n`);
      }

      await this.generateRound();
      await sleep(this.config.interval_ms);
    }
  }

  stop(): void {
    this.running = false;
    console.log("[Scenario] Stopped");
  }

  private pickNextScenario(): ScenarioType {
    const scenarios: ScenarioType[] = [
      "bull_market",
      "bear_market",
      "catalog_shortage",
      "review_boom",
      "race_to_bottom",
      "gold_rush",
    ];
    return pick(scenarios);
  }

  async generateRound(): Promise<void> {
    const tasks: string[] = [];

    switch (this.currentScenario) {
      case "bull_market": {
        // 4-6 tasks, 1.5x-3.0x cost
        const count = Math.round(rand(4, 6));
        for (let i = 0; i < count; i++) {
          const type = pick(TASK_TYPES);
          const maxBid = TASK_COST_BASELINES[type] * rand(1.5, 3.0);
          const id = await createTask(type, maxBid, this.config.deadline_minutes);
          if (id) tasks.push(`${type}:$${maxBid.toFixed(3)}`);
        }
        break;
      }

      case "bear_market": {
        // 1-2 tasks, 0.9x-1.3x cost (some unprofitable!)
        const count = Math.round(rand(1, 2));
        for (let i = 0; i < count; i++) {
          const type = pick(TASK_TYPES);
          const maxBid = TASK_COST_BASELINES[type] * rand(0.9, 1.3);
          const id = await createTask(type, maxBid, this.config.deadline_minutes);
          if (id) tasks.push(`${type}:$${maxBid.toFixed(3)}`);
        }
        break;
      }

      case "catalog_shortage": {
        // 3-4 tasks but NO CATALOG type
        const count = Math.round(rand(3, 4));
        const types = [TaskType.REVIEW, TaskType.CURATION];
        for (let i = 0; i < count; i++) {
          const type = pick(types);
          const maxBid = TASK_COST_BASELINES[type] * rand(1.2, 2.0);
          const id = await createTask(type, maxBid, this.config.deadline_minutes);
          if (id) tasks.push(`${type}:$${maxBid.toFixed(3)}`);
        }
        break;
      }

      case "review_boom": {
        // 5-8 tasks, mostly REVIEW
        const count = Math.round(rand(5, 8));
        for (let i = 0; i < count; i++) {
          const type = Math.random() < 0.75 ? TaskType.REVIEW : pick(TASK_TYPES);
          const maxBid = TASK_COST_BASELINES[type] * rand(1.3, 2.5);
          const id = await createTask(type, maxBid, this.config.deadline_minutes);
          if (id) tasks.push(`${type}:$${maxBid.toFixed(3)}`);
        }
        break;
      }

      case "race_to_bottom": {
        // 4-5 tasks, 0.95x-1.15x cost (barely profitable or loss-making)
        const count = Math.round(rand(4, 5));
        for (let i = 0; i < count; i++) {
          const type = pick(TASK_TYPES);
          const maxBid = TASK_COST_BASELINES[type] * rand(0.95, 1.15);
          const id = await createTask(type, maxBid, this.config.deadline_minutes);
          if (id) tasks.push(`${type}:$${maxBid.toFixed(3)}`);
        }
        break;
      }

      case "gold_rush": {
        // 1-2 tasks with HUGE payoffs (4x-8x cost)
        const count = Math.round(rand(1, 2));
        for (let i = 0; i < count; i++) {
          const type = pick(TASK_TYPES);
          const maxBid = TASK_COST_BASELINES[type] * rand(4.0, 8.0);
          const id = await createTask(type, maxBid, this.config.deadline_minutes);
          if (id) tasks.push(`${type}:$${maxBid.toFixed(3)}`);
        }
        break;
      }
    }

    console.log(`[Scenario:${this.currentScenario}] Round ${this.round}: ${tasks.join(", ") || "(none)"}`);
  }
}

// ============================================================================
// HELPER
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
