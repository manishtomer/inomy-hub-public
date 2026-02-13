/**
 * GET /api/arena/snapshots
 *
 * Agent balance/reputation time-series for charts.
 * Query params: season_id, agent_id, from_round, to_round, limit
 */

import { NextResponse, NextRequest } from 'next/server';
import { arenaService } from '@/lib/services/arena/ArenaService';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('season_id') || undefined;
    const agentId = searchParams.get('agent_id') || undefined;
    const fromRound = searchParams.get('from_round') ? parseInt(searchParams.get('from_round')!) : undefined;
    const toRound = searchParams.get('to_round') ? parseInt(searchParams.get('to_round')!) : undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;

    const snapshots = await arenaService.getSnapshots({
      seasonId,
      agentId,
      fromRound,
      toRound,
      limit,
    });

    return NextResponse.json({ success: true, data: snapshots });
  } catch (error) {
    console.error('[Arena/snapshots] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
