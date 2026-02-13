/**
 * GET /api/tournaments — List fantasy tournaments
 * POST /api/tournaments — Create fantasy tournament
 */

import { NextResponse, NextRequest } from 'next/server';
import { fantasyTournamentService } from '@/lib/services/tournaments/FantasyTournamentService';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const tournaments = await fantasyTournamentService.listTournaments(status);
    return NextResponse.json({ success: true, data: tournaments });
  } catch (error) {
    console.error('[Tournaments] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, created_by, entry_fee } = body;

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Name is required' },
        { status: 400 }
      );
    }

    const tournament = await fantasyTournamentService.createTournament(
      name, created_by, Number(entry_fee) || 0
    );
    return NextResponse.json({ success: true, data: tournament });
  } catch (error) {
    console.error('[Tournaments] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
