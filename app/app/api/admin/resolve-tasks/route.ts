import { NextResponse, NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { createEvent } from "@/lib/api-helpers";
import { TASK_OPERATIONAL_COSTS } from "@/lib/x402";

/**
 * POST /api/admin/resolve-tasks
 *
 * Resolves open task auctions by selecting the highest-score bidder as winner.
 * Score = reputation / bid (rewards both high reputation AND low bids).
 *
 * This is AUCTION RESOLUTION only (OPEN → ASSIGNED).
 * Actual payment + work happens later via POST /api/task-delivery/[taskId]:
 *   1. Operator pays winning agent the bid amount via x402
 *   2. Agent executes work
 *   3. Agent pays operational cost to cost sink (plain USDC)
 *   4. Task goes ASSIGNED → COMPLETED
 *
 * Query params:
 *   task_id?: string - Resolve a specific task only
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const specificTaskId = searchParams.get("task_id");

    // Step 1: Find all OPEN tasks with bids
    let tasksQuery = supabase
      .from("tasks")
      .select("id, type, max_bid, input_ref")
      .eq("status", "OPEN");

    if (specificTaskId) {
      tasksQuery = tasksQuery.eq("id", specificTaskId);
    }

    const { data: openTasks, error: tasksError } = await tasksQuery;

    if (tasksError) {
      return NextResponse.json(
        { success: false, error: `Failed to query tasks: ${tasksError.message}` },
        { status: 400 }
      );
    }

    if (!openTasks || openTasks.length === 0) {
      return NextResponse.json({
        success: true,
        data: { resolved: 0, details: [] },
        message: specificTaskId ? "Task not found or already resolved" : "No open tasks found",
      });
    }

    const resolvedDetails: {
      task_id: string;
      task_type: string;
      winner_agent_id: string;
      winner_name: string;
      winning_bid: number;
      estimated_operational_cost: number;
      estimated_net_profit: number;
      total_bids: number;
      rejected_bids: number;
      score: number;
    }[] = [];

    // Step 2: Process each task
    for (const task of openTasks) {
      // Get all PENDING bids with agent reputation
      const { data: bids, error: bidsError } = await supabase
        .from("bids_cache")
        .select("id, agent_id, bidder_wallet, amount, agents(id, name, wallet_address, balance, reputation)")
        .eq("task_id", task.id)
        .eq("status", "PENDING");

      if (bidsError || !bids || bids.length === 0) continue;

      // Select winner: highest score
      // Formula: score = (100 + reputation * 2) / bid
      // Reputation is 0-5 stars, gives 0-10% bonus. Price is primary factor.
      const REP_MAX = 5;
      const BASE_SCORE = 100;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scoredBids = bids.map((b: any) => {
        const reputation = Math.min(b.agents?.reputation ?? 3, REP_MAX); // Default 3 stars
        const repBonus = reputation * 2; // 0-10 range
        const score = b.amount > 0 ? (BASE_SCORE + repBonus) / b.amount : 0;
        return { ...b, score };
      });
      scoredBids.sort((a: { score: number }, b: { score: number }) => b.score - a.score);

      const winningBid = scoredBids[0];
      const losingBids = scoredBids.slice(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const winnerAgent = (winningBid as any).agents;

      if (!winnerAgent) {
        console.warn(`[Resolve Tasks] Could not find agent ${winningBid.agent_id}, skipping task ${task.id}`);
        continue;
      }

      // Step 3: Update task status to ASSIGNED
      const { error: taskUpdateError } = await supabase
        .from("tasks")
        .update({
          status: "ASSIGNED",
          assigned_agent_id: winnerAgent.id,
          winning_bid_id: winningBid.id,
        })
        .eq("id", task.id);

      if (taskUpdateError) {
        console.error(`[Resolve Tasks] Failed to update task ${task.id}:`, taskUpdateError);
        continue;
      }

      // Step 4: Update bid statuses
      await supabase.from("bids_cache").update({ status: "ACCEPTED" }).eq("id", winningBid.id);

      if (losingBids.length > 0) {
        const losingBidIds = losingBids.map((b) => b.id);
        await supabase.from("bids_cache").update({ status: "REJECTED" }).in("id", losingBidIds);

        // Deduct bidding cost from losing agents (0.001 USDC per rejected bid)
        const BIDDING_COST = 0.001;
        for (const losingBid of losingBids) {
          if (!losingBid.agent_id) continue;
          const { data: losingAgent } = await supabase
            .from("agents")
            .select("balance")
            .eq("id", losingBid.agent_id)
            .single();

          if (losingAgent) {
            const newBalance = Math.max(0, Math.round((losingAgent.balance - BIDDING_COST) * 1000) / 1000);
            await supabase.from("agents").update({ balance: newBalance }).eq("id", losingBid.agent_id);
          }
        }
      }

      // Compute estimated profit for the response (actual payment happens in task-delivery)
      const revenue = winningBid.amount;
      const taskType = task.type as keyof typeof TASK_OPERATIONAL_COSTS;
      const operationalCost = TASK_OPERATIONAL_COSTS[taskType] || 0.05;
      const netProfit = revenue - operationalCost;

      // Step 5: Log task assignment event
      await createEvent({
        event_type: "task_assigned",
        description: `Task ${task.type} assigned to ${winnerAgent.name} for $${revenue} USDC (score: ${winningBid.score.toFixed(1)}, ${bids.length} bids)`,
        agent_wallets: [winnerAgent.wallet_address || winnerAgent.id],
        amount: revenue,
        metadata: {
          task_id: task.id,
          task_type: task.type,
          winning_bid: revenue,
          score: winningBid.score,
          total_bids: bids.length,
          rejected_bids: losingBids.length,
          input_ref: task.input_ref,
          currency: "USDC",
        },
      });

      resolvedDetails.push({
        task_id: task.id,
        task_type: task.type,
        winner_agent_id: winnerAgent.id,
        winner_name: winnerAgent.name,
        winning_bid: revenue,
        estimated_operational_cost: operationalCost,
        estimated_net_profit: Math.round(netProfit * 1000) / 1000,
        total_bids: bids.length,
        rejected_bids: losingBids.length,
        score: Math.round(winningBid.score * 10) / 10,
      });

      console.log(
        `[Resolve Tasks] ${task.id}: ${winnerAgent.name} won | bid: $${revenue} | est. cost: $${operationalCost} | est. profit: $${netProfit.toFixed(3)} | score: ${winningBid.score.toFixed(1)} (${bids.length} bids)`
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        resolved: resolvedDetails.length,
        details: resolvedDetails,
        note: "Tasks are now ASSIGNED. Call POST /api/task-delivery/[taskId] to execute payment + work.",
      },
    });
  } catch (err) {
    console.error("[Resolve Tasks] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
