import { NextResponse, NextRequest } from "next/server";
import { getAllTasks, createTask } from "@/lib/api-helpers";
import type { CreateTaskRequest } from "@/types/database";

/**
 * GET /api/tasks
 * Fetch all tasks with optional filters
 * Query params: limit, status, type, include_bids (boolean)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!)
      : undefined;
    const status = searchParams.get("status") || undefined;
    const type = searchParams.get("type") || undefined;
    const include_bids = searchParams.get("include_bids") === "true";

    const { data, error } = await getAllTasks({ limit, status, type, include_bids });

    if (error) {
      return NextResponse.json(
        { success: false, error: `Failed to fetch tasks: ${error.message}` },
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
    console.error("Error fetching tasks:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tasks
 * Create a new task
 * Body: CreateTaskRequest
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateTaskRequest;

    // Validate required fields
    if (!body.type || !body.input_ref || body.max_bid === undefined || !body.deadline) {
      return NextResponse.json(
        {
          success: false,
          error: "Type, input_ref, max_bid, and deadline are required",
        },
        { status: 400 }
      );
    }

    const { data, error } = await createTask(body);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (err) {
    console.error("Error creating task:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
