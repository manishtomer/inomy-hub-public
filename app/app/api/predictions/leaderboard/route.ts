/**
 * GET /api/predictions/leaderboard
 *
 * Get prediction accuracy rankings.
 */

import { NextResponse, NextRequest } from 'next/server';
import { predictionService } from '@/lib/services/predictions/PredictionService';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');

    const leaderboard = await predictionService.getLeaderboard(limit);

    return NextResponse.json({ success: true, data: leaderboard });
  } catch (error) {
    console.error('[Predictions/leaderboard] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
