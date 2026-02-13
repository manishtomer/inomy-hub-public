/**
 * Platform Buyback API
 *
 * POST /api/platform/buyback
 * Triggers a buyback: spends deployer MON to buy INOMY on nad.fun and burn it.
 *
 * Body (optional): { monAmount: string }  — defaults to BUYBACK_DEFAULT_MON
 *
 * Protected: requires ADMIN_API_KEY header or DEPLOYER_PRIVATE_KEY must be set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeBuyback, getBuybackQuote } from '@/lib/platform-buyback';
import { BUYBACK_DEFAULT_MON, PLATFORM_TOKEN_ADDRESS } from '@/lib/platform-config';

export async function POST(request: NextRequest) {
  try {
    // Basic auth check — require admin key if configured
    const adminKey = process.env.ADMIN_API_KEY;
    if (adminKey) {
      const authHeader = request.headers.get('x-admin-key');
      if (authHeader !== adminKey) {
        return NextResponse.json(
          { success: false, error: 'Unauthorized' },
          { status: 401 },
        );
      }
    }

    if (!PLATFORM_TOKEN_ADDRESS) {
      return NextResponse.json(
        { success: false, error: 'PLATFORM_TOKEN_ADDRESS not configured — deploy INOMY token first' },
        { status: 400 },
      );
    }

    if (!process.env.DEPLOYER_PRIVATE_KEY) {
      return NextResponse.json(
        { success: false, error: 'DEPLOYER_PRIVATE_KEY not configured' },
        { status: 500 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const monAmount = body.monAmount || BUYBACK_DEFAULT_MON;

    console.log(`[Buyback API] Executing buyback: ${monAmount} MON`);

    const result = await executeBuyback(monAmount);

    return NextResponse.json({
      success: result.success,
      data: result,
    });
  } catch (err) {
    console.error('[Buyback API] Error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Buyback failed',
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/platform/buyback?amount=0.05
 * Get a quote without executing (read-only).
 */
export async function GET(request: NextRequest) {
  try {
    if (!PLATFORM_TOKEN_ADDRESS) {
      return NextResponse.json(
        { success: false, error: 'PLATFORM_TOKEN_ADDRESS not configured' },
        { status: 400 },
      );
    }

    const monAmount = request.nextUrl.searchParams.get('amount') || BUYBACK_DEFAULT_MON;

    const quote = await getBuybackQuote(monAmount);

    return NextResponse.json({
      success: true,
      data: quote,
    });
  } catch (err) {
    console.error('[Buyback API] Quote error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Quote failed',
      },
      { status: 500 },
    );
  }
}
