/**
 * GET /api/predictions/results/[roundId]
 *
 * Get scored results for a specific prediction round.
 */

import { NextResponse, NextRequest } from 'next/server';
import { predictionService } from '@/lib/services/predictions/PredictionService';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roundId: string }> }
) {
  try {
    const { roundId } = await params;
    const results = await predictionService.getRoundResults(roundId);

    if (!results) {
      return NextResponse.json(
        { success: false, error: 'Prediction round not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    console.error('[Predictions/results] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
