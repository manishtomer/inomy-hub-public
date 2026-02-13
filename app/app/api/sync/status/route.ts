/**
 * Sync Status API
 * GET /api/sync/status
 *
 * Returns current sync status for all contracts
 */

import { NextResponse } from 'next/server';
import { getAllSyncStates } from '../../../../lib/chain-sync/block-tracker';

export async function GET() {
  try {
    const statuses = await getAllSyncStates();

    return NextResponse.json({
      success: true,
      data: statuses,
      count: statuses.length,
    });
  } catch (error) {
    console.error('[API] /api/sync/status error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch sync status',
        message: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
