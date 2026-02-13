/**
 * Personal Memory Service
 *
 * Manages Layer 2 memory: individual agent experiences and learnings.
 * Each agent has their own memory that only they can access.
 *
 * Created: 2026-02-06
 */

import { supabase } from '@/lib/supabase';
import type { PersonalMemoryType, PersonalMemoryEntry, MemoryContext } from './memory-types';
import { generatePersonalNarrative } from './memory-narrator';

/**
 * Create a new personal memory with LLM-generated narrative
 * Called when significant events happen to an agent
 */
export async function createPersonalMemory(
  agentId: string,
  type: PersonalMemoryType,
  data: Record<string, unknown>,
  roundNumber: number,
  context: MemoryContext,
  triggerContext?: string,
  importanceScore: number = 0.5
): Promise<PersonalMemoryEntry | null> {
  try {
    // Generate narrative via LLM
    const narrative = await generatePersonalNarrative(
      type,
      data,
      context,
      roundNumber
    );

    const { data: inserted, error } = await supabase
      .from('agent_memories')
      .insert({
        agent_id: agentId,
        memory_type: type,
        round_number: roundNumber,
        trigger_context: triggerContext,
        data,
        narrative,
        importance_score: importanceScore,
      })
      .select()
      .single();

    if (error) {
      console.error('[Personal Memory] Failed to insert memory:', error);
      return null;
    }

    console.log(`[Personal Memory] Created ${type} memory for agent ${agentId}`);
    return inserted as PersonalMemoryEntry;
  } catch (error) {
    console.error('[Personal Memory] Error creating memory:', error);
    return null;
  }
}

/**
 * Get recent personal memories for an agent
 * Returns memories ordered by creation time (newest first)
 */
export async function getRecentPersonalMemories(
  agentId: string,
  limit: number = 10
): Promise<PersonalMemoryEntry[]> {
  try {
    const { data, error } = await supabase
      .from('agent_memories')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Personal Memory] Failed to fetch memories:', error);
      return [];
    }

    return (data as PersonalMemoryEntry[]) || [];
  } catch (error) {
    console.error('[Personal Memory] Error fetching memories:', error);
    return [];
  }
}

/**
 * Get personal memories filtered by type
 */
export async function getPersonalMemoriesByType(
  agentId: string,
  type: PersonalMemoryType,
  limit: number = 5
): Promise<PersonalMemoryEntry[]> {
  try {
    const { data, error } = await supabase
      .from('agent_memories')
      .select('*')
      .eq('agent_id', agentId)
      .eq('memory_type', type)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Personal Memory] Failed to fetch memories by type:', error);
      return [];
    }

    return (data as PersonalMemoryEntry[]) || [];
  } catch (error) {
    console.error('[Personal Memory] Error fetching memories by type:', error);
    return [];
  }
}

/**
 * Get most important learnings for an agent
 * Returns learnings and QBR insights ordered by importance score
 */
export async function getImportantLearnings(
  agentId: string,
  limit: number = 3
): Promise<PersonalMemoryEntry[]> {
  try {
    const { data, error } = await supabase
      .from('agent_memories')
      .select('*')
      .eq('agent_id', agentId)
      .in('memory_type', ['learning', 'qbr_insight'])
      .order('importance_score', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Personal Memory] Failed to fetch learnings:', error);
      return [];
    }

    return (data as PersonalMemoryEntry[]) || [];
  } catch (error) {
    console.error('[Personal Memory] Error fetching learnings:', error);
    return [];
  }
}

/**
 * Get memories for a specific round range
 */
export async function getMemoriesInRange(
  agentId: string,
  fromRound: number,
  toRound: number
): Promise<PersonalMemoryEntry[]> {
  try {
    const { data, error } = await supabase
      .from('agent_memories')
      .select('*')
      .eq('agent_id', agentId)
      .gte('round_number', fromRound)
      .lte('round_number', toRound)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Personal Memory] Failed to fetch memories in range:', error);
      return [];
    }

    return (data as PersonalMemoryEntry[]) || [];
  } catch (error) {
    console.error('[Personal Memory] Error fetching memories in range:', error);
    return [];
  }
}

/**
 * Mark memory as recalled (updates recency tracking)
 * Called when a memory is used in brain context
 */
export async function markMemoryRecalled(memoryId: string): Promise<void> {
  try {
    // First, get current times_recalled value
    const { data: current } = await supabase
      .from('agent_memories')
      .select('times_recalled')
      .eq('id', memoryId)
      .single();

    if (!current) {
      console.error('[Personal Memory] Memory not found for recall tracking');
      return;
    }

    // Update with incremented value
    const { error } = await supabase
      .from('agent_memories')
      .update({
        times_recalled: (current.times_recalled || 0) + 1,
        last_recalled_at: new Date().toISOString(),
      })
      .eq('id', memoryId);

    if (error) {
      console.error('[Personal Memory] Failed to mark memory as recalled:', error);
    }
  } catch (error) {
    console.error('[Personal Memory] Error marking memory as recalled:', error);
  }
}

/**
 * Get memory statistics for an agent
 */
export async function getMemoryStats(agentId: string): Promise<{
  total_memories: number;
  by_type: Record<PersonalMemoryType, number>;
  avg_importance: number;
  most_recalled: PersonalMemoryEntry | null;
}> {
  try {
    const { data: memories, error } = await supabase
      .from('agent_memories')
      .select('*')
      .eq('agent_id', agentId);

    if (error || !memories) {
      return {
        total_memories: 0,
        by_type: {} as Record<PersonalMemoryType, number>,
        avg_importance: 0,
        most_recalled: null,
      };
    }

    const typedMemories = memories as PersonalMemoryEntry[];

    // Count by type
    const byType = typedMemories.reduce((acc, m) => {
      acc[m.memory_type] = (acc[m.memory_type] || 0) + 1;
      return acc;
    }, {} as Record<PersonalMemoryType, number>);

    // Calculate average importance
    const avgImportance = typedMemories.length > 0
      ? typedMemories.reduce((sum, m) => sum + m.importance_score, 0) / typedMemories.length
      : 0;

    // Find most recalled
    const mostRecalled = typedMemories.sort((a, b) => b.times_recalled - a.times_recalled)[0] || null;

    return {
      total_memories: typedMemories.length,
      by_type: byType,
      avg_importance: avgImportance,
      most_recalled: mostRecalled,
    };
  } catch (error) {
    console.error('[Personal Memory] Error fetching stats:', error);
    return {
      total_memories: 0,
      by_type: {} as Record<PersonalMemoryType, number>,
      avg_importance: 0,
      most_recalled: null,
    };
  }
}
