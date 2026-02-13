/**
 * GET /api/arena/state
 *
 * Returns current arena state: round, season, lock status, auto-run config.
 */

import { NextResponse } from 'next/server';
import { arenaService } from '@/lib/services/arena/ArenaService';

export async function GET() {
  try {
    const state = await arenaService.getArenaState();
    return NextResponse.json({ success: true, data: state });
  } catch (error) {
    console.error('[Arena/state] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
