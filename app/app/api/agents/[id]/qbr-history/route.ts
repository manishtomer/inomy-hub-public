/**
 * QBR History Endpoint
 *
 * GET /api/agents/:id/qbr-history
 *
 * Returns paginated QBR records for an agent, showing the history
 * of strategic reviews and decisions made.
 */

import { NextResponse, NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: agentId } = await params;

  if (!agentId) {
    return NextResponse.json(
      { success: false, error: "Agent ID is required" },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "10", 10), 50);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  try {
    // Fetch QBR records
    const { data: qbrRecords, error, count } = await supabase
      .from("qbr_history")
      .select("*", { count: "exact" })
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      // Table might not exist yet
      if (error.code === "42P01") {
        return NextResponse.json({
          success: true,
          data: {
            qbr_records: [],
            total: 0,
            agent_id: agentId,
            message: "QBR history table not yet created. Run migration 20260206_qbr_exception_history.sql"
          },
          pagination: { limit, offset },
        });
      }
      throw error;
    }

    // Transform records for API response
    const transformedRecords = (qbrRecords || []).map((record) => ({
      id: record.id,
      qbr_number: record.qbr_number,
      period: record.period,
      input_metrics: record.input_metrics,
      decisions: record.decisions,
      outcome: record.outcome,
      created_at: record.created_at,
    }));

    return NextResponse.json({
      success: true,
      data: {
        qbr_records: transformedRecords,
        total: count || 0,
        agent_id: agentId,
      },
      pagination: { limit, offset },
    });
  } catch (error) {
    console.error("[QBR-HISTORY] Error fetching QBR records:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch QBR history",
      },
      { status: 500 }
    );
  }
}
