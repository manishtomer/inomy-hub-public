/**
 * Manual QBR Trigger Endpoint (Testing Only)
 *
 * POST /api/agents/:id/qbr/trigger
 *
 * Manually triggers a QBR for an agent, useful for testing Gemini integration
 * and tool calling without waiting for scheduled QBR rounds.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { executeQBR } from "@/lib/agent-runtime/qbr-handler";
import { createRuntimeLogger } from "@/lib/agent-runtime/logger";

const logger = createRuntimeLogger("info");

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(
  _request: NextRequest,
  { params }: RouteParams
) {
  const agentId = (await params).id;

  logger.info(`[QBR-TEST] Manual QBR trigger requested for agent ${agentId}`);

  try {
    // Verify agent exists
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .single();

    if (agentError || !agent) {
      logger.error(`[QBR-TEST] Agent not found: ${agentId}`);
      return NextResponse.json(
        { error: `Agent ${agentId} not found`, success: false },
        { status: 404 }
      );
    }

    logger.info(`[QBR-TEST] Agent found: ${agent.name} (${agent.type})`);

    // Get current round from simulation_state (global round counter)
    const { data: simState } = await supabase
      .from("simulation_state")
      .select("current_round")
      .eq("id", "global")
      .single();

    const currentRound = simState?.current_round || 0;

    logger.info(`[QBR-TEST] Current round: ${currentRound}`);

    // Trigger QBR
    const startTime = Date.now();
    logger.info(`[QBR-TEST] Starting QBR execution...`);

    try {
      await executeQBR({
        agent_id: agentId,
        trigger_reason: "manual",
        current_round: currentRound + 1,
      });

      const duration = Date.now() - startTime;
      logger.info(`[QBR-TEST] QBR completed successfully in ${duration}ms`);

      // Fetch updated agent state
      const { data: updatedAgent } = await supabase
        .from("agents")
        .select("*")
        .eq("id", agentId)
        .single();

      // Fetch latest policy
      const { data: latestPolicy } = await supabase
        .from("agent_policies")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      // Fetch latest QBR record
      const { data: latestQBR } = await supabase
        .from("qbr_history")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      // Fetch latest investor update
      const { data: latestUpdate } = await supabase
        .from("investor_updates")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      return NextResponse.json(
        {
          success: true,
          message: "QBR completed successfully",
          duration_ms: duration,
          agent: {
            id: updatedAgent?.id,
            name: updatedAgent?.name,
            balance: updatedAgent?.balance,
            reputation: updatedAgent?.reputation,
          },
          policy: {
            version: latestPolicy?.version,
            trigger: latestPolicy?.trigger,
            reasoning: latestPolicy?.reasoning,
            brain_cost: latestPolicy?.brain_cost,
          },
          qbr: latestQBR
            ? {
                qbr_number: latestQBR.qbr_number,
                period: latestQBR.period,
                decisions: latestQBR.decisions,
              }
            : null,
          investor_update: latestUpdate
            ? {
                trigger_type: latestUpdate.trigger_type,
                observations: latestUpdate.observations,
                changes: latestUpdate.changes,
                impacts: latestUpdate.impacts,
              }
            : null,
        },
        { status: 200 }
      );
    } catch (qbrError) {
      const duration = Date.now() - startTime;
      const errorMessage = qbrError instanceof Error ? qbrError.message : String(qbrError);

      logger.error(
        `[QBR-TEST] QBR execution failed after ${duration}ms:`,
        errorMessage
      );

      return NextResponse.json(
        {
          success: false,
          message: "QBR execution failed",
          error: errorMessage,
          duration_ms: duration,
          note: "Check server logs for [QBR-TEST] and [BRAIN] messages",
        },
        { status: 500 }
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[QBR-TEST] Unexpected error:`, errorMessage);

    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error",
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check QBR readiness
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteParams
) {
  const agentId = (await params).id;

  logger.info(`[QBR-TEST] Checking QBR readiness for agent ${agentId}`);

  try {
    // Check agent exists
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .single();

    if (agentError || !agent) {
      return NextResponse.json(
        {
          ready: false,
          message: "Agent not found",
          agent_id: agentId,
        },
        { status: 404 }
      );
    }

    // Check policy exists (get the latest policy)
    const { data: policy } = await supabase
      .from("agent_policies")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Check environment
    const hasGeminiKey = !!process.env.GOOGLE_API_KEY;

    return NextResponse.json(
      {
        ready: !!policy && hasGeminiKey,
        checks: {
          agent_exists: true,
          policy_exists: !!policy,
          gemini_configured: hasGeminiKey,
        },
        agent: {
          id: agent.id,
          name: agent.name,
          type: agent.type,
          status: agent.status,
          balance: agent.balance,
          reputation: agent.reputation,
        },
        policy: policy
          ? {
              version: policy.version,
              personality: policy.personality,
              created_at: policy.created_at,
            }
          : null,
        message: !hasGeminiKey
          ? "Gemini not configured. Set GOOGLE_API_KEY in .env.local"
          : !policy
            ? "Agent policy not set. Create policy first."
            : "Ready for QBR testing",
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ready: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
