/**
 * GET /api/predictions/current
 *
 * Get current prediction questions for the next round.
 */

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { predictionService } from '@/lib/services/predictions/PredictionService';

export async function GET() {
  try {
    // Get current round
    const { data: state } = await supabase
      .from('simulation_state')
      .select('current_round')
      .eq('id', 'global')
      .single();

    const nextRound = (state?.current_round || 0) + 1;
    const round = await predictionService.getOrCreatePredictionRound(nextRound);

    return NextResponse.json({ success: true, data: round });
  } catch (error) {
    console.error('[Predictions/current] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
