/**
 * Exception History Endpoint
 *
 * GET /api/agents/:id/exceptions
 *   Returns paginated exception records for an agent
 *
 * POST /api/agents/:id/exceptions/:exceptionId/resolve
 *   Marks an exception as resolved
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
  const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const resolvedFilter = searchParams.get("resolved");
  const typeFilter = searchParams.get("type");

  try {
    // Build query
    let query = supabase
      .from("exception_history")
      .select("*", { count: "exact" })
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false });

    // Apply filters
    if (resolvedFilter !== null) {
      query = query.eq("resolved", resolvedFilter === "true");
    }
    if (typeFilter) {
      query = query.eq("exception_type", typeFilter);
    }

    query = query.range(offset, offset + limit - 1);

    const { data: exceptions, error, count } = await query;

    if (error) {
      // Table might not exist yet
      if (error.code === "42P01") {
        return NextResponse.json({
          success: true,
          data: {
            exceptions: [],
            total: 0,
            unresolved_count: 0,
            agent_id: agentId,
            message: "Exception history table not yet created. Run migration 20260206_qbr_exception_history.sql"
          },
          pagination: { limit, offset },
        });
      }
      throw error;
    }

    // Get unresolved count
    const { count: unresolvedCount } = await supabase
      .from("exception_history")
      .select("*", { count: "exact", head: true })
      .eq("agent_id", agentId)
      .eq("resolved", false);

    // Transform records
    const transformedExceptions = (exceptions || []).map((ex) => ({
      id: ex.id,
      exception_type: ex.exception_type,
      exception_details: ex.exception_details,
      current_value: Number(ex.current_value),
      threshold: Number(ex.threshold),
      brain_response: ex.brain_response,
      resolved: ex.resolved,
      resolved_at: ex.resolved_at,
      time_to_resolution_rounds: ex.time_to_resolution_rounds,
      created_at: ex.created_at,
    }));

    return NextResponse.json({
      success: true,
      data: {
        exceptions: transformedExceptions,
        total: count || 0,
        unresolved_count: unresolvedCount || 0,
        agent_id: agentId,
      },
      pagination: { limit, offset },
    });
  } catch (error) {
    console.error("[EXCEPTIONS] Error fetching exception records:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch exceptions",
      },
      { status: 500 }
    );
  }
}

/**
 * POST - Resolve a specific exception
 * Body: { exception_id: string, rounds_to_resolve?: number }
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: agentId } = await params;

  if (!agentId) {
    return NextResponse.json(
      { success: false, error: "Agent ID is required" },
      { status: 400 }
    );
  }

  try {
    const body = await req.json();
    const { exception_id, rounds_to_resolve } = body;

    if (!exception_id) {
      return NextResponse.json(
        { success: false, error: "exception_id is required" },
        { status: 400 }
      );
    }

    // Verify exception exists and belongs to agent
    const { data: existing, error: fetchError } = await supabase
      .from("exception_history")
      .select("*")
      .eq("id", exception_id)
      .eq("agent_id", agentId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { success: false, error: "Exception not found" },
        { status: 404 }
      );
    }

    if (existing.resolved) {
      return NextResponse.json(
        { success: false, error: "Exception already resolved" },
        { status: 400 }
      );
    }

    // Mark as resolved
    const { data: updated, error: updateError } = await supabase
      .from("exception_history")
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        time_to_resolution_rounds: rounds_to_resolve || null,
      })
      .eq("id", exception_id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        exception_type: updated.exception_type,
        resolved: updated.resolved,
        resolved_at: updated.resolved_at,
        time_to_resolution_rounds: updated.time_to_resolution_rounds,
      },
    });
  } catch (error) {
    console.error("[EXCEPTIONS] Error resolving exception:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to resolve exception",
      },
      { status: 500 }
    );
  }
}
