/**
 * Policy History Endpoint
 *
 * GET /api/agents/:id/policies
 *
 * Returns all policy versions for an agent, showing the evolution
 * of the agent's strategy over time.
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
    // Fetch policy records
    const { data: policies, error, count } = await supabase
      .from("agent_policies")
      .select("*", { count: "exact" })
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    // Get current (latest) version
    const currentVersion = policies && policies.length > 0 ? policies[0].version : 0;

    // Transform records for API response
    const transformedPolicies = (policies || []).map((policy) => ({
      id: policy.id,
      version: policy.version,
      personality: policy.personality,
      policy_json: policy.policy_json,
      trigger_type: policy.trigger_type || "initial",
      reasoning: policy.reasoning || "",
      brain_cost: policy.brain_cost || 0,
      created_at: policy.created_at,
    }));

    return NextResponse.json({
      success: true,
      data: {
        policies: transformedPolicies,
        current_version: currentVersion,
        agent_id: agentId,
      },
      pagination: { limit, offset },
      total: count || 0,
    });
  } catch (error) {
    console.error("[POLICIES] Error fetching policy records:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch policies",
      },
      { status: 500 }
    );
  }
}

/**
 * GET the current (latest) policy only
 * Use query param ?current=true
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { id: agentId } = await params;

  if (!agentId) {
    return NextResponse.json(
      { success: false, error: "Agent ID is required" },
      { status: 400 }
    );
  }

  // This endpoint can be used to manually trigger a policy update
  // For now, just return current policy
  try {
    const { data: currentPolicy, error } = await supabase
      .from("agent_policies")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({
          success: false,
          error: "No policy found for agent",
        }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      data: {
        id: currentPolicy.id,
        version: currentPolicy.version,
        personality: currentPolicy.personality,
        policy_json: currentPolicy.policy_json,
        trigger_type: currentPolicy.trigger_type || "initial",
        reasoning: currentPolicy.reasoning || "",
        brain_cost: currentPolicy.brain_cost || 0,
        created_at: currentPolicy.created_at,
      },
    });
  } catch (error) {
    console.error("[POLICIES] Error fetching current policy:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch policy",
      },
      { status: 500 }
    );
  }
}
