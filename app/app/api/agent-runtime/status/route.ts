import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/agent-runtime/status
 *
 * Returns the current status of all agents in the runtime.
 * Queries agent_runtime_state and joins with agents and agent_policies tables.
 */
export async function GET() {
  // Query all runtime states
  const { data: runtimeStates, error: statesError } = await supabase
    .from("agent_runtime_state")
    .select("*")
    .order("last_active_at", { ascending: false });

  if (statesError) {
    return NextResponse.json(
      { success: false, error: `Failed to query runtime states: ${statesError.message}` },
      { status: 500 }
    );
  }

  if (!runtimeStates || runtimeStates.length === 0) {
    return NextResponse.json({
      success: true,
      data: {
        total_agents: 0,
        running_agents: 0,
        agents: [],
      },
    });
  }

  // Get agent details for all runtime agents
  const agentIds = runtimeStates.map((s) => s.agent_id);
  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, type, status, balance, reputation")
    .in("id", agentIds);

  // Get policy info
  const { data: policies } = await supabase
    .from("agent_policies")
    .select("agent_id, personality, policy_version")
    .in("agent_id", agentIds);

  // Build agent map
  const agentMap = new Map((agents || []).map((a) => [a.id, a]));
  const policyMap = new Map((policies || []).map((p) => [p.agent_id, p]));

  // Build status for each agent
  const agentStatuses = runtimeStates.map((state) => {
    const agent = agentMap.get(state.agent_id);
    const policy = policyMap.get(state.agent_id);

    const winRate =
      state.total_bids > 0 ? state.total_wins / state.total_bids : 0;
    const profit = parseFloat(state.total_revenue) - parseFloat(state.total_costs);

    return {
      agent_id: state.agent_id,
      agent_name: agent?.name || "Unknown",
      agent_type: agent?.type || "Unknown",
      agent_status: agent?.status || "Unknown",
      personality: policy?.personality || "Unknown",
      policy_version: policy?.policy_version || 0,

      // Runtime state
      is_running: state.is_running,
      current_round: state.current_round,
      last_active_at: state.last_active_at,

      // Performance
      total_bids: state.total_bids,
      total_wins: state.total_wins,
      win_rate: Math.round(winRate * 1000) / 10, // One decimal %
      win_rate_last_20: Math.round(parseFloat(state.win_rate_last_20) * 1000) / 10,
      consecutive_losses: state.consecutive_losses,
      consecutive_wins: state.consecutive_wins,

      // Financials
      balance: agent?.balance || 0,
      total_revenue: parseFloat(state.total_revenue),
      total_costs: parseFloat(state.total_costs),
      profit: Math.round(profit * 1000) / 1000,
      reputation: agent?.reputation || 0,

      // Brain usage
      total_brain_wakeups: state.total_brain_wakeups,
      total_brain_cost: parseFloat(state.total_brain_cost),
      total_policy_changes: state.total_policy_changes ?? 0,
    };
  });

  const runningCount = agentStatuses.filter((a) => a.is_running).length;

  return NextResponse.json({
    success: true,
    data: {
      total_agents: agentStatuses.length,
      running_agents: runningCount,
      agents: agentStatuses,
    },
  });
}
