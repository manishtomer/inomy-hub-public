/**
 * Agent Memories API
 * GET /api/agents/[id]/memories
 *
 * Returns personal memories, industry memories, policy history, and brain activity
 *
 * Query params:
 *   type: PersonalMemoryType - filter by memory type
 *   limit: number (default: 10, max: 100)
 *   include_stats: boolean - include memory statistics
 *   include_industry: boolean - include industry memories
 *   include_brain: boolean - include brain activity (policies, exceptions)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  getRecentPersonalMemories,
  getPersonalMemoriesByType,
  getImportantLearnings,
  getMemoryStats,
} from '@/lib/agent-runtime/personal-memory';
import { getRecentIndustryEvents } from '@/lib/agent-runtime/industry-memory';
import type { PersonalMemoryType } from '@/lib/agent-runtime/memory-types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params;
    const { searchParams } = new URL(request.url);

    // Query parameters
    const type = searchParams.get('type') as PersonalMemoryType | null;
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 100);
    const includeStats = searchParams.get('include_stats') === 'true';
    const includeIndustry = searchParams.get('include_industry') === 'true';
    const includeBrain = searchParams.get('include_brain') === 'true';

    // Fetch memories based on filter
    let memories;
    if (type === 'learning' || type === 'qbr_insight') {
      // Get important learnings
      memories = await getImportantLearnings(agentId, limit);
    } else if (type) {
      // Filter by specific type
      memories = await getPersonalMemoriesByType(agentId, type, limit);
    } else {
      // Get all recent memories
      memories = await getRecentPersonalMemories(agentId, limit);
    }

    // Optionally include stats
    let stats = null;
    if (includeStats) {
      stats = await getMemoryStats(agentId);
    }

    // Optionally include industry memories
    let industryMemories = null;
    if (includeIndustry) {
      industryMemories = await getRecentIndustryEvents(limit);
    }

    // Optionally include brain activity
    let brainActivity = null;
    if (includeBrain) {
      // Get policy history
      const { data: policyHistory } = await supabase
        .from('agent_policies')
        .select('id, policy_json, created_at')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(10);

      // Get exception history
      const { data: exceptionHistory } = await supabase
        .from('exception_history')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(10);

      // Get current policy
      const currentPolicy = policyHistory && policyHistory.length > 0
        ? policyHistory[0].policy_json
        : null;

      brainActivity = {
        current_policy: currentPolicy,
        policy_versions: policyHistory?.length || 0,
        policy_history: policyHistory || [],
        exception_history: exceptionHistory || [],
        total_brain_wakeups: exceptionHistory?.length || 0,
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        memories,
        stats,
        industry_memories: industryMemories,
        brain_activity: brainActivity,
      },
      source: 'database',
    });
  } catch (error) {
    console.error('[API] Failed to fetch agent memories:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch memories',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
