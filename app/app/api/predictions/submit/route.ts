/**
 * POST /api/predictions/submit
 *
 * Submit prediction answers.
 * Body: { prediction_round_id: string, user_wallet: string, answers: Record<string, string> }
 */

import { NextResponse, NextRequest } from 'next/server';
import { predictionService } from '@/lib/services/predictions/PredictionService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prediction_round_id, user_wallet, answers } = body;

    if (!prediction_round_id || !user_wallet || !answers) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: prediction_round_id, user_wallet, answers' },
        { status: 400 }
      );
    }

    const prediction = await predictionService.submitPrediction(
      prediction_round_id,
      user_wallet,
      answers
    );

    return NextResponse.json({ success: true, data: prediction });
  } catch (error) {
    console.error('[Predictions/submit] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
