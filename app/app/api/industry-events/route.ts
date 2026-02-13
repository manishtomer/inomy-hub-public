/**
 * Industry Events API
 * GET /api/industry-events
 *
 * Returns recent industry memory events (shared across all agents)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getRecentIndustryEvents,
  getIndustryEventsByType,
  getIndustryEventsInRange,
} from '@/lib/agent-runtime/industry-memory';
import type { IndustryEventType } from '@/lib/agent-runtime/memory-types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Query parameters
    const type = searchParams.get('type') as IndustryEventType | null;
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const fromRound = searchParams.get('from_round');
    const toRound = searchParams.get('to_round');

    // Fetch events based on filters
    let events;
    if (fromRound && toRound) {
      // Get events in specific round range
      events = await getIndustryEventsInRange(
        parseInt(fromRound, 10),
        parseInt(toRound, 10)
      );
    } else if (type) {
      // Filter by specific event type
      events = await getIndustryEventsByType(type, limit);
    } else {
      // Get recent events
      events = await getRecentIndustryEvents(limit);
    }

    return NextResponse.json({
      success: true,
      data: {
        events,
        count: events.length,
      },
      source: 'database',
    });
  } catch (error) {
    console.error('[API] Failed to fetch industry events:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch industry events',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
