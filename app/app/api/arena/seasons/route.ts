/**
 * GET /api/arena/seasons
 *
 * List all seasons with champions.
 */

import { NextResponse } from 'next/server';
import { arenaService } from '@/lib/services/arena/ArenaService';

export async function GET() {
  try {
    const seasons = await arenaService.getSeasons();
    return NextResponse.json({ success: true, data: seasons });
  } catch (error) {
    console.error('[Arena/seasons] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
