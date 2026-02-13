import { NextResponse, NextRequest } from "next/server";
import { getAllPartnerships, createPartnership } from "@/lib/api-helpers";
import type { CreatePartnershipRequest } from "@/types/database";

/**
 * GET /api/partnerships
 * Fetch all partnerships with optional filters
 * Query params: status (string), limit (number)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status") || undefined;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!)
      : undefined;

    const { data, error } = await getAllPartnerships({
      status,
      limit,
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: `Failed to fetch partnerships: ${error.message}` },
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
    console.error("Error fetching partnerships:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/partnerships
 * Create a new partnership
 * Body: CreatePartnershipRequest
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreatePartnershipRequest;

    // Validate required fields
    if (!body.partner_a_wallet || !body.partner_b_wallet || body.split_a === undefined || body.split_b === undefined) {
      return NextResponse.json(
        {
          success: false,
          error: "partner_a_wallet, partner_b_wallet, split_a, and split_b are required"
        },
        { status: 400 }
      );
    }

    // Validate splits add up to 100
    if (body.split_a + body.split_b !== 100) {
      return NextResponse.json(
        { success: false, error: "split_a and split_b must add up to 100" },
        { status: 400 }
      );
    }

    // Validate splits are positive
    if (body.split_a < 0 || body.split_b < 0) {
      return NextResponse.json(
        { success: false, error: "Splits must be non-negative" },
        { status: 400 }
      );
    }

    // Create the partnership
    const { data, error } = await createPartnership({
      partner_a_wallet: body.partner_a_wallet,
      partner_b_wallet: body.partner_b_wallet,
      split_a: body.split_a,
      split_b: body.split_b,
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (err) {
    console.error("Error creating partnership:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
