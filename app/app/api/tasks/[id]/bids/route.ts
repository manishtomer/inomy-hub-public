import { NextResponse, NextRequest } from "next/server";
import { getBidsByTaskId, createBid, getTaskById } from "@/lib/api-helpers";
import type { CreateBidRequest } from "@/types/database";

/**
 * GET /api/tasks/[id]/bids
 * Fetch all bids for a specific task
 * Query params: limit (number)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!)
      : undefined;

    // Verify task exists
    const { data: task, error: taskError } = await getTaskById(taskId);

    if (taskError) {
      return NextResponse.json(
        { success: false, error: taskError.message },
        { status: 400 }
      );
    }

    if (!task) {
      return NextResponse.json(
        { success: false, error: "Task not found" },
        { status: 404 }
      );
    }

    const { data, error } = await getBidsByTaskId(taskId, { limit });

    if (error) {
      return NextResponse.json(
        { success: false, error: `Failed to fetch bids: ${error.message}` },
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
    console.error("Error fetching bids:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tasks/[id]/bids
 * Submit a bid on a task
 * Body: { bidder_wallet: string, amount: number }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const body = await request.json();

    // Validate required fields
    if (!body.bidder_wallet || body.amount === undefined) {
      return NextResponse.json(
        { success: false, error: "bidder_wallet and amount are required" },
        { status: 400 }
      );
    }

    // Verify task exists
    const { data: task, error: taskError } = await getTaskById(taskId);

    if (taskError) {
      return NextResponse.json(
        { success: false, error: taskError.message },
        { status: 400 }
      );
    }

    if (!task) {
      return NextResponse.json(
        { success: false, error: "Task not found" },
        { status: 404 }
      );
    }

    // Validate bid amount is positive
    if (body.amount <= 0) {
      return NextResponse.json(
        { success: false, error: "Bid amount must be positive" },
        { status: 400 }
      );
    }

    // Validate bid doesn't exceed max_bid
    if (body.amount > task.max_bid) {
      return NextResponse.json(
        {
          success: false,
          error: `Bid amount (${body.amount}) cannot exceed max_bid (${task.max_bid})`
        },
        { status: 400 }
      );
    }

    // Validate task is still open
    if (task.status !== "OPEN") {
      return NextResponse.json(
        { success: false, error: "Cannot bid on a task that is not OPEN" },
        { status: 400 }
      );
    }

    const bidRequest: CreateBidRequest = {
      task_id: taskId,
      bidder_wallet: body.bidder_wallet,
      amount: body.amount,
    };

    const { data, error } = await createBid(bidRequest);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (err) {
    console.error("Error creating bid:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
