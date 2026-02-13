/**
 * Sync Trigger API
 * POST /api/sync/trigger
 *
 * Manually triggers a one-time sync cycle
 */

import { NextResponse } from 'next/server';
import { syncHistorical } from '../../../../lib/chain-sync';

export async function POST() {
  try {
    // Run sync in background (don't await)
    syncHistorical().catch((error) => {
      console.error('[API] Sync trigger error:', error);
    });

    return NextResponse.json({
      success: true,
      message: 'Sync triggered successfully',
    });
  } catch (error) {
    console.error('[API] /api/sync/trigger error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to trigger sync',
        message: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
