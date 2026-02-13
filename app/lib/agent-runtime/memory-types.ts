/**
 * Memory System Type Definitions
 *
 * Two-layer memory system:
 * 1. Industry Memory - Shared market events all agents can see
 * 2. Personal Memory - Individual agent experiences and learnings
 *
 * Each memory has BOTH structured data (JSONB) and LLM-written narrative (TEXT)
 *
 * Created: 2026-02-06
 */

/**
 * Industry event types (shared market observations)
 */
export type IndustryEventType =
  | 'market_crash'           // Multiple agents died this round
  | 'price_compression'      // Avg winning bids dropped significantly
  | 'demand_surge'           // Task volume increased significantly
  | 'new_competitor_wave'    // Multiple new agents of same type entered
  | 'partnership_trend'      // Partnerships becoming more common
  | 'agent_death'            // A specific agent died
  | 'market_shift'           // General market condition change
  | 'industry_report';       // Periodic analyst report published

/**
 * Personal memory types (individual agent experiences)
 */
export type PersonalMemoryType =
  | 'bid_outcome'        // A bid I made and its outcome
  | 'task_execution'     // A task I completed (success/failure)
  | 'partnership_event'  // Partnership formed/ended/rejected
  | 'exception_handled'  // An exception I handled
  | 'qbr_insight'        // Strategic insight from QBR
  | 'learning'           // Something I learned from experience
  | 'competitor_insight'; // Observation about a competitor

/**
 * Severity levels for industry events
 */
export type EventSeverity = 'low' | 'normal' | 'high' | 'critical';

/**
 * Industry memory entry from database
 */
export interface IndustryMemoryEntry {
  id: string;
  round_number: number;
  event_type: IndustryEventType;
  data: Record<string, unknown>;  // Structured data for querying
  narrative: string;               // LLM-written market observer narrative
  agents_affected: number;
  severity: EventSeverity;
  created_at: string;
}

/**
 * Personal memory entry from database
 */
export interface PersonalMemoryEntry {
  id: string;
  agent_id: string;
  memory_type: PersonalMemoryType;
  round_number: number;
  trigger_context: string | null;
  data: Record<string, unknown>;  // Structured data for querying
  narrative: string;               // LLM-written first-person journal entry
  importance_score: number;        // 0.00-1.00
  times_recalled: number;
  last_recalled_at: string | null;
  created_at: string;
}

/**
 * Context needed to generate memory narratives
 */
export interface MemoryContext {
  identity: {
    name: string;
    type: string;
    personality: string;
  };
  balance: number;
  reputation: number;
  currentRound?: number;
  recentHistory?: Array<{
    round: number;
    event: string;
    outcome: string;
  }>;
}
