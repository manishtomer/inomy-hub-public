import { NextResponse, NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/agents/[id]/bid-history
 * Returns an agent's bid history grouped for chart visualization
 *
 * Query params:
 *   - limit (number) - max number of bids to return (default: 200)
 *
 * Response includes:
 *   - bids: Array of bid data with margins, costs, and status
 *   - balance_history: Running balance calculated from economy events
 *   - summary: Aggregate stats (total bids, wins, losses, averages)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "200", 10);

    // Fetch agent to get wallet address
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, wallet_address, name")
      .eq("id", id)
      .single();

    if (agentError || !agent) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    // Fetch bids with task details (for task type)
    const { data: bidsData, error: bidsError } = await supabase
      .from("bids_cache")
      .select(`
        id,
        amount,
        status,
        created_at,
        policy_used,
        task_id,
        tasks!bids_cache_task_id_fkey (
          type
        )
      `)
      .eq("agent_id", id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (bidsError) {
      console.error("Error fetching bids:", bidsError);
      return NextResponse.json(
        { success: false, error: `Failed to fetch bid history: ${bidsError.message}` },
        { status: 500 }
      );
    }

    // Fetch economy events for balance history
    const { data: eventsData, error: eventsError } = agent.wallet_address
      ? await supabase
          .from("economy_events")
          .select("id, event_type, amount, created_at")
          .contains("agent_wallets", [agent.wallet_address])
          .in("event_type", ["task_payment", "cost_sink_payment", "investment", "token_bought", "token_sold"])
          .order("created_at", { ascending: true })
      : { data: null, error: null };

    if (eventsError) {
      console.error("Error fetching economy events:", eventsError);
      // Don't fail the whole request, just continue without balance history
    }

    // Transform bids data (reverse to chronological — query fetches most recent first)
    const bids = (bidsData || []).reverse().map((bid: any) => {
      const policyUsed = bid.policy_used || {};

      // Extract margin from policy_used (try both margin and actual_margin)
      const margin = policyUsed.actual_margin ?? policyUsed.margin ?? null;

      // Extract task cost
      const taskCost = policyUsed.task_cost ?? null;

      // Get task type from join
      const taskType = bid.tasks?.type ?? null;

      return {
        id: bid.id,
        amount: Number(bid.amount),
        status: bid.status as "PENDING" | "WON" | "LOST",
        margin,
        task_cost: taskCost,
        created_at: bid.created_at,
        task_type: taskType,
      };
    });

    // Calculate running balance from economy events
    const balanceHistory: Array<{
      timestamp: string;
      balance: number;
      event_type: string;
    }> = [];

    if (eventsData && eventsData.length > 0) {
      let runningBalance = 0;

      eventsData.forEach((event: any) => {
        const amount = Number(event.amount) || 0;
        const eventType = event.event_type as string;

        // Inflows (positive): task_payment, investment, token_bought
        // Outflows (negative): cost_sink_payment, token_sold
        if (["task_payment", "investment", "token_bought"].includes(eventType)) {
          runningBalance += amount;
        } else if (["cost_sink_payment", "token_sold"].includes(eventType)) {
          runningBalance -= amount;
        }

        balanceHistory.push({
          timestamp: event.created_at,
          balance: runningBalance,
          event_type: eventType,
        });
      });
    }

    // Calculate summary statistics
    const totalBids = bids.length;
    const wins = bids.filter((b) => b.status === "WON").length;
    const losses = bids.filter((b) => b.status === "LOST").length;

    const avgBid =
      totalBids > 0
        ? bids.reduce((sum, b) => sum + b.amount, 0) / totalBids
        : 0;

    const winBids = bids.filter((b) => b.status === "WON");
    const avgWinBid =
      winBids.length > 0
        ? winBids.reduce((sum, b) => sum + b.amount, 0) / winBids.length
        : 0;

    const lossBids = bids.filter((b) => b.status === "LOST");
    const avgLossBid =
      lossBids.length > 0
        ? lossBids.reduce((sum, b) => sum + b.amount, 0) / lossBids.length
        : 0;

    const marginsArray = bids
      .filter((b) => b.margin !== null)
      .map((b) => b.margin as number);
    const avgMargin =
      marginsArray.length > 0
        ? marginsArray.reduce((sum, m) => sum + m, 0) / marginsArray.length
        : 0;

    return NextResponse.json({
      success: true,
      data: {
        bids,
        balance_history: balanceHistory,
        summary: {
          total_bids: totalBids,
          wins,
          losses,
          avg_bid: avgBid,
          avg_margin: avgMargin,
          avg_win_bid: avgWinBid,
          avg_loss_bid: avgLossBid,
        },
      },
    });
  } catch (err) {
    console.error("Error fetching bid history:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
