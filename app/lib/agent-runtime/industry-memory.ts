/**
 * Industry Memory Service
 *
 * Manages Layer 1 memory: shared market events that all agents can observe.
 * Industry events help agents understand market conditions and adapt strategies.
 *
 * Created: 2026-02-06
 */

import { supabase } from '@/lib/supabase';
import type { IndustryEventType, IndustryMemoryEntry, EventSeverity } from './memory-types';
import { generateIndustryNarrative } from './memory-narrator';

/**
 * Record a new industry event with LLM-generated narrative
 * Called by market monitor or protocol events
 */
export async function recordIndustryEvent(
  roundNumber: number,
  eventType: IndustryEventType,
  data: Record<string, unknown>,
  severity: EventSeverity = 'normal',
  agentsAffected: number = 0
): Promise<IndustryMemoryEntry | null> {
  try {
    // Generate narrative via LLM
    const narrative = await generateIndustryNarrative(eventType, data, roundNumber);

    const { data: inserted, error } = await supabase
      .from('industry_memory')
      .insert({
        round_number: roundNumber,
        event_type: eventType,
        data,
        narrative,
        severity,
        agents_affected: agentsAffected,
      })
      .select()
      .single();

    if (error) {
      console.error('[Industry Memory] Failed to insert event:', error);
      return null;
    }

    console.log(`[Industry Memory] Recorded ${eventType} event for round ${roundNumber}`);
    return inserted as IndustryMemoryEntry;
  } catch (error) {
    console.error('[Industry Memory] Error recording event:', error);
    return null;
  }
}

/**
 * Get recent industry events for context
 * Returns events ordered by round number (newest first)
 */
export async function getRecentIndustryEvents(
  limit: number = 5
): Promise<IndustryMemoryEntry[]> {
  try {
    const { data, error } = await supabase
      .from('industry_memory')
      .select('*')
      .order('round_number', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Industry Memory] Failed to fetch events:', error);
      return [];
    }

    return (data as IndustryMemoryEntry[]) || [];
  } catch (error) {
    console.error('[Industry Memory] Error fetching events:', error);
    return [];
  }
}

/**
 * Get industry events relevant to a specific agent type
 * Future: filter by relevance to agent type (for now returns all recent)
 */
export async function getRelevantIndustryEvents(
  _agentType: string,
  limit: number = 5
): Promise<IndustryMemoryEntry[]> {
  // For now, return all recent events
  // Future enhancement: filter by events relevant to agent type
  // e.g., only show catalog-related events to catalog agents
  return getRecentIndustryEvents(limit);
}

/**
 * Get industry events by type
 */
export async function getIndustryEventsByType(
  eventType: IndustryEventType,
  limit: number = 10
): Promise<IndustryMemoryEntry[]> {
  try {
    const { data, error } = await supabase
      .from('industry_memory')
      .select('*')
      .eq('event_type', eventType)
      .order('round_number', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Industry Memory] Failed to fetch events by type:', error);
      return [];
    }

    return (data as IndustryMemoryEntry[]) || [];
  } catch (error) {
    console.error('[Industry Memory] Error fetching events by type:', error);
    return [];
  }
}

/**
 * Get industry events for a specific round range
 */
export async function getIndustryEventsInRange(
  fromRound: number,
  toRound: number
): Promise<IndustryMemoryEntry[]> {
  try {
    const { data, error } = await supabase
      .from('industry_memory')
      .select('*')
      .gte('round_number', fromRound)
      .lte('round_number', toRound)
      .order('round_number', { ascending: false });

    if (error) {
      console.error('[Industry Memory] Failed to fetch events in range:', error);
      return [];
    }

    return (data as IndustryMemoryEntry[]) || [];
  } catch (error) {
    console.error('[Industry Memory] Error fetching events in range:', error);
    return [];
  }
}

/**
 * Detect and record industry events based on market state
 * Called at end of each round by the simulation/monitor
 *
 * Detection rules:
 * - 2+ agents die in one round → market_crash (critical)
 * - Avg winning bid drops 20%+ → price_compression (high)
 * - Task volume up 50%+ → demand_surge (normal)
 * - 3+ new agents of same type → new_competitor_wave (normal)
 * - Single agent dies → agent_death (low)
 */
export async function detectAndRecordIndustryEvents(
  roundNumber: number
): Promise<void> {
  // TODO: Implement detection logic
  // This will be called by the market monitor at the end of each round
  // For now, this is a placeholder for future implementation

  // Example detection patterns:
  // 1. Query agents table for status changes to DEAD this round
  // 2. Query bids_cache for winning bid price changes
  // 3. Query tasks table for volume changes
  // 4. Query agents table for new agent creations

  console.log(`[Industry Memory] Detection not yet implemented for round ${roundNumber}`);
}
