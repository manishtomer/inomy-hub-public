/**
 * Agent Runtime - Public Exports
 *
 * The autonomous agent runtime that brings AI agents to life
 * as economic actors in the Agent-Owned Commerce Protocol.
 */

// Types
export type {
  PersonalityType,
  AgentPolicy,
  AgentCostStructure,
  AgentRuntimeState,
  AgentIdentity,
  BidDecision,
  PartnershipDecision,
  ExceptionType,
  ExceptionTrigger,
  BrainPolicyUpdate,
  QBRResult,
  PartnershipAction,
  InvestorUpdateData,
  InvestorUpdateChange,
  RuntimeConfig,
  ActionResult,
} from "./types";

// Memory Types
export type {
  IndustryEventType,
  PersonalMemoryType,
  EventSeverity,
  IndustryMemoryEntry,
  PersonalMemoryEntry,
  MemoryContext,
} from "./memory-types";

// Constants
export { AGENT_COSTS, PERSONALITY_DEFAULTS, DEFAULT_RUNTIME_CONFIG } from "./constants";

// Autopilot (policy engine - no LLM)
export {
  evaluateAuction,
  evaluatePartnership,
  checkExceptions,
  isQBRDue,
  evaluateLifecycleStatus,
  calculateTaskCost,
  isBidProfitable,
  calculateProfit,
  calculateMargin,
  calculateRunway as calculateAutopilotRunway,
} from "./autopilot";

// Brain (LLM integration)
export { generateInitialPolicy, handleException, runQBR } from "./brain";

// State management
export {
  loadRuntimeState,
  saveRuntimeState,
  initializeRuntimeState,
  loadPolicy,
  savePolicy,
  loadAgentIdentity,
  recordBidResult,
  recordBrainWakeup,
  getActiveAgentIds,
  getRecentBids,
  getMarketContext,
  calculateRunway,
} from "./state";

// Actions
export {
  submitBid,
  acceptPartnership,
  rejectPartnership,
  proposePartnership,
  executeTask,
  submitWork,
  updateAgentBalance,
  createAgentEconomyEvent,
} from "./actions";

// Investor updates
export {
  storeInvestorUpdate,
  getInvestorUpdates,
  getLatestInvestorUpdate,
  getInvestorUpdateCount,
  getInvestorUpdateSummary,
  formatInvestorUpdate,
} from "./investor-updates";

// Runner
export { AgentRunner } from "./runner";

// Logger
export { createLogger, createRuntimeLogger } from "./logger";

// Memory System (Two-Layer: Industry + Personal)
export {
  recordIndustryEvent,
  getRecentIndustryEvents,
  getRelevantIndustryEvents,
  getIndustryEventsByType,
  getIndustryEventsInRange,
  detectAndRecordIndustryEvents,
} from "./industry-memory";

export {
  createPersonalMemory,
  getRecentPersonalMemories,
  getPersonalMemoriesByType,
  getImportantLearnings,
  getMemoriesInRange,
  markMemoryRecalled,
  getMemoryStats,
} from "./personal-memory";

export {
  generateIndustryNarrative,
  generatePersonalNarrative,
} from "./memory-narrator";

export {
  buildWakeUpContext,
  formatContextForPrompt,
} from "./context-builder";
