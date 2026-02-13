/**
 * POST /api/arena/auto
 *
 * Toggle auto-run mode and set interval/speed.
 * Body: { auto_run: boolean, interval_ms?: number, speed?: number }
 */

import { NextResponse, NextRequest } from 'next/server';
import { arenaService } from '@/lib/services/arena/ArenaService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const autoRun = body.auto_run ?? body.autoRun ?? false;
    const intervalMs = body.interval_ms ?? body.intervalMs;
    const speed = body.speed;

    await arenaService.updateAutoRun(autoRun, intervalMs, speed);

    const state = await arenaService.getArenaState();
    return NextResponse.json({ success: true, data: state });
  } catch (error) {
    console.error('[Arena/auto] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
