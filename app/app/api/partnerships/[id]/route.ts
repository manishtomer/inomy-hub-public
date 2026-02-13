import { NextResponse, NextRequest } from "next/server";
import { getPartnershipById, updatePartnership } from "@/lib/api-helpers";

/**
 * GET /api/partnerships/[id]
 * Fetch a single partnership by ID
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data, error } = await getPartnershipById(id);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: "Partnership not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("Error fetching partnership:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/partnerships/[id]
 * Update a partnership (typically status or balance)
 * Body: { status?: string, balance?: number }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Validate at least one field is provided
    if (!body.status && body.balance === undefined) {
      return NextResponse.json(
        { success: false, error: "At least one field (status or balance) is required" },
        { status: 400 }
      );
    }

    // Validate status if provided
    const validStatuses = ["PROPOSED", "NEGOTIATING", "ACTIVE", "DISSOLVED"];
    if (body.status && !validStatuses.includes(body.status)) {
      return NextResponse.json(
        { success: false, error: `Status must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate balance if provided
    if (body.balance !== undefined && body.balance < 0) {
      return NextResponse.json(
        { success: false, error: "Balance must be non-negative" },
        { status: 400 }
      );
    }

    const { data, error } = await updatePartnership(id, {
      status: body.status,
      balance: body.balance,
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("Error updating partnership:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
