import { NextResponse, NextRequest } from "next/server";
import { getAllInvestors, createInvestor } from "@/lib/api-helpers";
import type { CreateInvestorRequest } from "@/types/database";

/**
 * GET /api/investors
 * Fetch all investors with optional limit
 * Query params:
 *   - limit (number)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!)
      : undefined;

    const { data, error } = await getAllInvestors({ limit });

    if (error) {
      return NextResponse.json(
        { success: false, error: `Failed to fetch investors: ${error.message}` },
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
    console.error("Error fetching investors:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/investors
 * Create a new investor
 * Body: CreateInvestorRequest
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateInvestorRequest;

    // Validate required fields
    if (!body.name || !body.wallet_address) {
      return NextResponse.json(
        { success: false, error: "Name and wallet_address are required" },
        { status: 400 }
      );
    }

    // Validate wallet address format (basic check)
    if (!body.wallet_address.startsWith("0x") || body.wallet_address.length !== 42) {
      return NextResponse.json(
        { success: false, error: "Invalid wallet address format" },
        { status: 400 }
      );
    }

    const { data, error } = await createInvestor(body);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (err) {
    console.error("Error creating investor:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
