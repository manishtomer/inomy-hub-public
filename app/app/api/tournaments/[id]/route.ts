/**
 * GET /api/tournaments/[id] — Fantasy tournament detail
 * POST /api/tournaments/[id] — Actions: join, start
 */

import { NextResponse, NextRequest } from 'next/server';
import { fantasyTournamentService } from '@/lib/services/tournaments/FantasyTournamentService';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const detail = await fantasyTournamentService.getTournament(id);

    if (!detail) {
      return NextResponse.json(
        { success: false, error: 'Tournament not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: detail });
  } catch (error) {
    console.error('[Tournament] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const action = body.action;

    switch (action) {
      case 'validate': {
        const { player_wallet, team_name, agent_ids } = body;
        if (!player_wallet || !team_name || !agent_ids || agent_ids.length !== 3) {
          return NextResponse.json(
            { success: false, error: 'Required: player_wallet, team_name, agent_ids (array of 3)' },
            { status: 400 }
          );
        }
        await fantasyTournamentService.validateJoin(id, player_wallet, agent_ids);
        return NextResponse.json({ success: true });
      }

      case 'join': {
        const { player_wallet, team_name, agent_ids } = body;
        if (!player_wallet || !team_name || !agent_ids || agent_ids.length !== 3) {
          return NextResponse.json(
            { success: false, error: 'Required: player_wallet, team_name, agent_ids (array of 3)' },
            { status: 400 }
          );
        }
        const team = await fantasyTournamentService.joinTournament(
          id, player_wallet, team_name, agent_ids
        );
        return NextResponse.json({ success: true, data: team });
      }

      case 'start': {
        await fantasyTournamentService.startTournament(id);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[Tournament] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
