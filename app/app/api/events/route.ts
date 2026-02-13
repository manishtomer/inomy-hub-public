import { NextResponse, NextRequest } from "next/server";
import { getAllEvents, createEvent } from "@/lib/api-helpers";
import type { CreateEconomyEventRequest } from "@/types/database";

/**
 * GET /api/events
 * Fetch recent economy events
 * Query params: limit (number, default 20), event_type (string)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!)
      : 20;
    const eventType = searchParams.get("event_type") || undefined;

    const { data, error } = await getAllEvents({
      limit,
      event_type: eventType,
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: `Failed to fetch events: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      data: data || [],
      source: "database",
    });
  } catch (err) {
    console.error("Error fetching events:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/events
 * Create a new economy event
 * Body: CreateEconomyEventRequest
 * Note: This is typically used by internal systems or chain sync processes
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateEconomyEventRequest;

    // Validate required fields
    if (!body.event_type || !body.description) {
      return NextResponse.json(
        { success: false, error: "event_type and description are required" },
        { status: 400 }
      );
    }

    // Create the event
    const { data, error } = await createEvent({
      event_type: body.event_type,
      description: body.description,
      agent_wallets: body.agent_wallets || [],
      investor_wallet: body.investor_wallet || null,
      amount: body.amount || null,
      tx_hash: body.tx_hash || null,
      block_number: body.block_number || null,
      metadata: body.metadata || {},
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (err) {
    console.error("Error creating event:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
