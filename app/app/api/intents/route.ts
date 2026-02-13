import { NextResponse, NextRequest } from "next/server";
import { getAllIntents, createIntent } from "@/lib/api-helpers";
import type { CreateIntentRequest } from "@/types/database";

/**
 * GET /api/intents
 * Fetch all intents with optional filters
 * Query params: limit, status, category, include_responses
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!)
      : undefined;
    const status = searchParams.get("status") || undefined;
    const category = searchParams.get("category") || undefined;
    const include_responses = searchParams.get("include_responses") === "true";

    const { data, error } = await getAllIntents({ limit, status, category, include_responses });

    if (error) {
      return NextResponse.json(
        { success: false, error: `Failed to fetch intents: ${error.message}` },
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
    console.error("Error fetching intents:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/intents
 * Create a new intent
 * Body: CreateIntentRequest
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateIntentRequest;

    // Validate required fields
    if (!body.product_description || body.max_budget === undefined || !body.category) {
      return NextResponse.json(
        {
          success: false,
          error: "product_description, max_budget, and category are required",
        },
        { status: 400 }
      );
    }

    const { data, error } = await createIntent(body);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (err) {
    console.error("Error creating intent:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
