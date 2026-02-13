/**
 * GET /api/arena/seasons/[id]/leaderboard
 *
 * Get season leaderboard with agent rankings.
 */

import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: seasonId } = await params;

    // Get leaderboard entries
    const { data: entries, error } = await supabase
      .from('season_leaderboard')
      .select('*')
      .eq('season_id', seasonId)
      .order('rank', { ascending: true });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    if (!entries || entries.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // Get agent details (only nad.fun agents)
    const agentIds = entries.map(e => e.agent_id);
    const { data: agents } = await supabase
      .from('agents')
      .select('id, name, type, nadfun_pool_address')
      .in('id', agentIds)
      .not('nadfun_pool_address', 'is', null);

    const agentMap = new Map((agents || []).map(a => [a.id, a]));

    const leaderboard = entries
      .filter(e => agentMap.has(e.agent_id))
      .map((e, idx) => {
        const agent = agentMap.get(e.agent_id)!;
        return {
          rank: idx + 1,
          agentId: e.agent_id,
          agentName: agent.name || 'Unknown',
          agentType: agent.type || 'CATALOG',
          score: e.score,
          balanceDelta: e.balance_delta,
          winRate: e.win_rate,
          reputationDelta: e.reputation_delta,
          tasksWon: e.tasks_won,
          tasksBid: e.tasks_bid,
        };
      });

    return NextResponse.json({ success: true, data: leaderboard });
  } catch (error) {
    console.error('[Arena/leaderboard] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
