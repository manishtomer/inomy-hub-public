/**
 * Admin Cleanup API
 * POST /api/admin/cleanup
 *
 * Marks all ACTIVE agents as INACTIVE and resets simulation state.
 * Use this to start fresh with new agents.
 */

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST() {
  try {
    const results: string[] = [];

    // 1. Mark all non-DEAD agents as DEAD (valid statuses: UNFUNDED, ACTIVE, LOW_FUNDS, PAUSED, DEAD)
    const { data: agents, error: agentError } = await supabase
      .from("agents")
      .update({ status: "DEAD" })
      .neq("status", "DEAD")
      .select("id, name");

    if (agentError) {
      results.push(`Error updating agents: ${agentError.message}`);
    } else {
      results.push(`Marked ${agents?.length || 0} agents as DEAD`);
    }

    // 2. Reset simulation state to round 0
    const { error: simError } = await supabase
      .from("simulation_state")
      .upsert({ id: "global", current_round: 0, updated_at: new Date().toISOString() });

    if (simError) {
      results.push(`Note: simulation_state update failed (table may not exist)`);
    } else {
      results.push("Reset simulation state to round 0");
    }

    // 3. Optionally clear memories (commented out - uncomment to also clear memories)
    /*
    const { error: memError } = await supabase
      .from("agent_memories")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (!memError) {
      results.push("Cleared agent memories");
    }

    const { error: indError } = await supabase
      .from("industry_memory")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (!indError) {
      results.push("Cleared industry memories");
    }
    */

    return NextResponse.json({
      success: true,
      message: "Cleanup complete",
      details: results,
    });
  } catch (error) {
    console.error("[Cleanup] Error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
