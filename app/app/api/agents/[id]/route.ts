import { NextResponse, NextRequest } from "next/server";
import { getAgentById, updateAgent, deleteAgent } from "@/lib/api-helpers";
import { supabase } from "@/lib/supabase";
import { getOnChainUsdcBalance } from "@/lib/chain-sync/processors/usdc-balance";
import type { UpdateAgentRequest, Agent } from "@/types/database";
import type { AgentActivity } from "@/types/ui";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Fetch real agent detail data from Supabase
 */
async function fetchAgentDetails(agent: Agent) {
  const wallet = agent.wallet_address || null;
  const walletLower = wallet?.toLowerCase() || null;
  const agentId = agent.id;

  // Run all queries in parallel
  const [
    activityResult,
    partnershipsResult,
    tasksResult,
    bidsResult,
    holdingsResult,
    paymentEventsResult,
    costEventsResult,
    totalBidsResult,
    escrowDepositsResult,
  ] = await Promise.all([
    // Activity: recent economy events involving this agent
    wallet
      ? supabase
          .from("economy_events")
          .select("*")
          .contains("agent_wallets", [wallet])
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: null, error: null }),

    // Partnerships: where this agent is partner_a or partner_b
    wallet
      ? supabase
          .from("partnerships_cache")
          .select("*")
          .or(`partner_a_wallet.eq.${wallet},partner_b_wallet.eq.${wallet}`)
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: null, error: null }),

    // Active tasks assigned to this agent
    supabase
      .from("tasks")
      .select("*")
      .eq("assigned_agent_id", agentId)
      .in("status", ["OPEN", "ASSIGNED", "IN_PROGRESS"])
      .order("created_at", { ascending: false })
      .limit(10),

    // Recent bids by this agent
    supabase
      .from("bids_cache")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(5),

    // Token holdings (total invested in this agent) — holdings store lowercase wallets
    walletLower
      ? supabase
          .from("token_holdings_cache")
          .select("*")
          .eq("agent_wallet", walletLower)
      : Promise.resolve({ data: null, error: null }),

    // Real revenue: task_payment events where this agent received payment
    wallet
      ? supabase
          .from("economy_events")
          .select("amount")
          .contains("agent_wallets", [wallet])
          .eq("event_type", "task_payment")
      : Promise.resolve({ data: null, error: null }),

    // Real costs: operational + living costs (escrow_deposit excluded — investor share is profit, not cost)
    wallet
      ? supabase
          .from("economy_events")
          .select("amount")
          .contains("agent_wallets", [wallet])
          .in("event_type", ["cost_sink_payment", "living_cost"])
      : Promise.resolve({ data: null, error: null }),

    // Total bids count for win rate calculation
    supabase
      .from("bids_cache")
      .select("id", { count: "exact", head: true })
      .eq("agent_id", agentId),

    // Total dividends escrowed for investors
    supabase
      .from("escrow_deposits")
      .select("investor_share_total")
      .eq("agent_id", agentId),
  ]);

  // Convert economy events to AgentActivity format
  let activity: AgentActivity[] | null = null;
  if (activityResult.data && activityResult.data.length > 0) {
    activity = activityResult.data.map((ev: Record<string, unknown>) => {
      const eventType = ev.event_type as string;
      let activityType: AgentActivity["type"] = "task_completed";
      let status: AgentActivity["status"] = "info";

      // Outflow events: money leaving the agent
      const outflowTypes = [
        "cost_sink_payment", "living_cost", "escrow_deposit",
        "dividend_claimed", "token_sold", "agent_death",
      ];
      const isOutflow = outflowTypes.includes(eventType);

      switch (eventType) {
        case "task_completed":
        case "task_payment":
          activityType = "task_completed";
          status = "success";
          break;
        case "task_assigned":
          activityType = "task_completed";
          status = "info";
          break;
        case "cost_sink_payment":
        case "living_cost":
          activityType = "task_completed";
          status = "warning";
          break;
        case "escrow_deposit":
        case "dividend_claimed":
          activityType = "task_completed";
          status = "warning";
          break;
        case "investment":
        case "token_bought":
          activityType = "investment_received";
          status = "success";
          break;
        case "partnership":
          activityType = "partnership_formed";
          status = "info";
          break;
        case "agent_death":
        case "token_sold":
          activityType = "status_changed";
          status = "warning";
          break;
        case "reputation_changed":
          activityType = "status_changed";
          status = "info";
          break;
        default:
          activityType = "task_completed";
          status = "info";
      }

      const evMeta = (ev.metadata || {}) as Record<string, unknown>;
      const txHash = (ev.tx_hash as string) || (evMeta.tx_hash as string) || (evMeta.cost_tx_hash as string) || null;

      return {
        id: ev.id as string,
        type: activityType,
        description: ev.description as string,
        timestamp: ev.created_at as string,
        amount: ev.amount as number | undefined,
        status,
        tx_hash: txHash,
        isOutflow,
      };
    });
  }

  // Enrich partnerships with partner names
  let partnerships = null;
  if (partnershipsResult.data && partnershipsResult.data.length > 0) {
    const partnerWallets = partnershipsResult.data.map((p: Record<string, unknown>) =>
      (p.partner_a_wallet as string) === wallet ? p.partner_b_wallet : p.partner_a_wallet
    );

    // Fetch partner agent names
    const { data: partnerAgents } = await supabase
      .from("agents")
      .select("name, wallet_address")
      .in("wallet_address", partnerWallets as string[]);

    const nameByWallet = new Map<string, string>();
    if (partnerAgents) {
      partnerAgents.forEach((a: Record<string, unknown>) => {
        nameByWallet.set(a.wallet_address as string, a.name as string);
      });
    }

    partnerships = partnershipsResult.data.map((p: Record<string, unknown>) => {
      const isPartnerA = (p.partner_a_wallet as string) === wallet;
      const partnerWallet = isPartnerA ? p.partner_b_wallet : p.partner_a_wallet;
      return {
        ...p,
        partner_name: nameByWallet.get(partnerWallet as string) || "Unknown Agent",
        my_split: isPartnerA ? p.split_a : p.split_b,
      };
    });
  }

  // Calculate total invested from holdings
  let totalInvested = 0;
  if (holdingsResult.data && holdingsResult.data.length > 0) {
    totalInvested = holdingsResult.data.reduce(
      (sum: number, h: Record<string, unknown>) => sum + ((h.total_invested as number) || 0),
      0
    );
  }

  const activeTasks = tasksResult.data && tasksResult.data.length > 0 ? tasksResult.data : null;
  const recentBids = bidsResult.data && bidsResult.data.length > 0 ? bidsResult.data : null;

  // Sum real revenue from task_payment events (USDC received from operator)
  let realRevenue = 0;
  if (paymentEventsResult.data && paymentEventsResult.data.length > 0) {
    realRevenue = paymentEventsResult.data.reduce(
      (sum: number, ev: Record<string, unknown>) => sum + ((ev.amount as number) || 0),
      0
    );
  }

  // Sum real costs from cost_sink_payment events (USDC paid to cost sink)
  let realCosts = 0;
  if (costEventsResult.data && costEventsResult.data.length > 0) {
    realCosts = costEventsResult.data.reduce(
      (sum: number, ev: Record<string, unknown>) => sum + ((ev.amount as number) || 0),
      0
    );
  }

  // Get total bids count
  const totalBids = totalBidsResult.count || 0;

  // Sum total investor dividends from escrow deposits
  let totalDividends = 0;
  if (escrowDepositsResult.data && escrowDepositsResult.data.length > 0) {
    totalDividends = escrowDepositsResult.data.reduce(
      (sum: number, d: Record<string, unknown>) => sum + ((d.investor_share_total as number) || 0),
      0
    );
  }

  return { activity, partnerships, activeTasks, recentBids, totalInvested, realRevenue, realCosts, totalBids, totalDividends };
}

/**
 * Determine agent personality from metadata or behavior patterns
 */
function getPersonality(agent: Agent): string {
  // Try parsing from metadata_uri first (simulation agents store it there)
  try {
    const meta = JSON.parse(agent.metadata_uri || "{}");
    if (meta.personality) return meta.personality;
  } catch {
    // ignore parse errors
  }

  // Derive from behavior patterns
  const winRate = agent.tasks_completed + agent.tasks_failed > 0
    ? agent.tasks_completed / (agent.tasks_completed + agent.tasks_failed)
    : 0;

  if (agent.reputation >= 4.5 && winRate >= 0.8) return "conservative";
  if (agent.tasks_completed > 20 && winRate < 0.7) return "aggressive";
  if (agent.token_price > 2.5) return "opportunistic";
  return "balanced";
}

/**
 * GET /api/agents/[id]
 * Fetch a single agent by ID
 * Query params:
 *   - include_details (boolean) - if true, returns extended agent details with financials, activity
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const includeDetails = searchParams.get("include_details") === "true";

    const { data: agent, error } = await getAgentById(id);

    if (error) {
      return NextResponse.json(
        { success: false, error: `Failed to fetch agent: ${error.message}` },
        { status: 500 }
      );
    }

    if (!agent) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    // If extended details requested, add computed data
    if (includeDetails) {
      const realData = await fetchAgentDetails(agent);

      // Balance = on-chain USDC (source of truth). Chain-sync also keeps DB in sync.
      const agentBalance = agent.wallet_address
        ? await getOnChainUsdcBalance(agent.wallet_address, agent.id)
        : agent.balance || 0;

      // Compute financials from real economy_events data
      const totalRevenue = realData.realRevenue || agent.total_revenue || 0;
      const totalCosts = realData.realCosts || 0;
      const profitLoss = totalRevenue - totalCosts;
      const tasksCompleted = agent.tasks_completed || 0;
      // Burn rate per task = average operational cost per completed task
      const burnRatePerTask = tasksCompleted > 0 ? totalCosts / tasksCompleted : 0;
      // Runway = how many more tasks can be funded with current balance at current burn rate
      const runwayTasks = burnRatePerTask > 0 ? Math.floor(agentBalance / burnRatePerTask) : 999;
      const totalInvested = realData.totalInvested || 0;
      const personality = getPersonality(agent);

      const financials = {
        ...agent,
        balance: agentBalance, // Use DB balance (consistent with dashboard)
        personality,
        total_revenue: totalRevenue,
        total_costs: totalCosts,
        profit_loss: profitLoss,
        burn_rate_per_task: burnRatePerTask,
        runway_tasks: Math.min(runwayTasks, 999),
        total_invested: totalInvested,
        total_dividends: realData.totalDividends || 0,
      };

      return NextResponse.json({
        success: true,
        data: {
          ...financials,
          total_bids: realData.totalBids || 0,
          activity: realData.activity || [],
          thinking: [], // Will be populated when agent runtime is active
          partnerships: realData.partnerships || [],
          active_tasks: realData.activeTasks || [],
          recent_bids: realData.recentBids || [],
        },
        source: "database",
      });
    }

    return NextResponse.json({
      success: true,
      data: agent,
      source: "database",
    });
  } catch (err) {
    console.error("Error fetching agent:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/agents/[id]
 * Update an agent
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = (await request.json()) as UpdateAgentRequest;

    const { data, error } = await updateAgent(id, body);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("Error updating agent:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/agents/[id]
 * Delete an agent
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const { error } = await deleteAgent(id);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Agent deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting agent:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
