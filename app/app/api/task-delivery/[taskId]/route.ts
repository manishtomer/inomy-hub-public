/**
 * Task Delivery API - x402 Payment Endpoint
 *
 * The agent's winning bid IS the x402 payment requirement.
 * When an agent bids, it publishes: "I'll do this task for $X, pay me at 0xMyWallet."
 * This endpoint serves that bid as a 402 response, and settles payment on retry.
 *
 * POST /api/task-delivery/[taskId]
 * Headers: X-PAYMENT or PAYMENT-SIGNATURE (x402 payment proof)
 * Body: not required — all data comes from the winning bid in DB
 *
 * Flow:
 * 1. Look up task + winning bid + agent from DB (the bid IS the payment requirement)
 * 2. Verify task status = ASSIGNED
 * 3. handleX402Payment(request, agentWallet, bidAmount) — x402 gate
 * 4. If 402 → return agent's payment requirements (from bid)
 * 5. Execute task work (mock for now)
 * 6. economyService.processTaskCompletion(useBlockchain: settled) — handles cost sink, escrow, DB updates, events
 * 7. Mark task COMPLETED
 * 8. Return result
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { handleX402Payment } from "@/lib/x402";
import { economyService } from "@/lib/services";
import { taskService } from "@/lib/services";

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { taskId } = await params;

  try {
    // Step 1: Look up task + winning bid + agent — all from DB
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id, type, status, max_bid, assigned_agent_id, winning_bid_id, created_at")
      .eq("id", taskId)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
    }

    if (task.status !== "ASSIGNED") {
      return NextResponse.json(
        { error: `Task status is ${task.status}, expected ASSIGNED` },
        { status: 400 }
      );
    }

    if (!task.winning_bid_id || !task.assigned_agent_id) {
      return NextResponse.json(
        { error: "Task has no winning bid or assigned agent" },
        { status: 400 }
      );
    }

    // Fetch winning bid and agent in parallel
    const [bidResult, agentResult] = await Promise.all([
      supabase
        .from("bids_cache")
        .select("id, amount, agent_id, bidder_wallet, status, task_id, created_at")
        .eq("id", task.winning_bid_id)
        .single(),
      supabase
        .from("agents")
        .select("id, name, type, wallet_address, privy_wallet_id, balance, total_revenue, tasks_completed, reputation, investor_share_bps, personality")
        .eq("id", task.assigned_agent_id)
        .single(),
    ]);

    if (bidResult.error || !bidResult.data) {
      console.error("[Task Delivery] Bid lookup failed:", bidResult.error, "winning_bid_id:", task.winning_bid_id);
      return NextResponse.json(
        { error: "Winning bid not found", detail: bidResult.error?.message },
        { status: 404 }
      );
    }

    if (agentResult.error || !agentResult.data) {
      return NextResponse.json(
        { error: "Assigned agent not found" },
        { status: 404 }
      );
    }

    const bid = bidResult.data;
    const agent = agentResult.data;
    const bidAmount = Number(bid.amount);
    const taskType = task.type;

    if (!agent.wallet_address) {
      return NextResponse.json(
        { error: "Agent has no wallet configured" },
        { status: 503 }
      );
    }

    // Step 2: x402 payment gate
    const description = `Task ${taskType} delivery payment to ${agent.name} (bid ${bid.id})`;
    const paymentResult = await handleX402Payment(
      request,
      agent.wallet_address,
      bidAmount,
      description
    );

    // Step 3: If 402, return the agent's payment requirements (derived from bid)
    if (!paymentResult.paid) {
      return new Response(JSON.stringify(paymentResult.body), {
        status: paymentResult.status,
        headers: {
          "Content-Type": "application/json",
          ...(paymentResult.headers || {}),
        },
      });
    }

    // Step 4: Execute task work (mock for now)
    const taskResult = executeMockTaskWork(taskType, taskId);

    // Step 5: Process completion
    // useBlockchain = settled: only do real USDC transfers (cost sink, escrow)
    // when x402 actually settled on-chain (operator actually paid the agent).
    // When fallback/manual mode, just update DB balances.
    const economic = await economyService.processTaskCompletion(
      {
        id: taskId,
        type: taskType,
        status: task.status,
        max_bid: task.max_bid,
        created_at: task.created_at,
      },
      {
        id: bid.id,
        task_id: bid.task_id,
        agent_id: bid.agent_id,
        bidder_wallet: bid.bidder_wallet,
        amount: bidAmount,
        score: 0, // Score is computed at runtime, not stored in DB
        status: bid.status,
        created_at: bid.created_at,
      },
      {
        id: agent.id,
        name: agent.name,
        type: agent.type,
        balance: agent.balance,
        reputation: agent.reputation,
        personality: agent.personality || 'balanced',
        policy: null,
        wallet_address: agent.wallet_address,
        privy_wallet_id: agent.privy_wallet_id,
        investor_share_bps: agent.investor_share_bps,
      },
      { useBlockchain: paymentResult.settled, x402TxHash: paymentResult.settlementTxHash }
    );

    // Step 6: Mark task COMPLETED
    await taskService.completeTask(taskId);

    // Step 7: Return result
    return NextResponse.json({
      success: true,
      taskId,
      agentId: agent.id,
      agentName: agent.name,
      agentWallet: agent.wallet_address,
      taskType,
      bidAmount,
      bidId: bid.id,
      operationalCost: economic.cost,
      netProfit: Math.round(economic.profit * 1000) / 1000,
      platformCut: economic.blockchainPayment?.platformCut ?? 0,
      profitSplit: economic.blockchainPayment ? {
        agentShare: Math.round(economic.blockchainPayment.agentShare * 1000) / 1000,
        investorShare: Math.round(economic.blockchainPayment.investorShareTotal * 1000) / 1000,
        holderCount: economic.blockchainPayment.holderCount,
      } : undefined,
      result: taskResult,
      x402Settled: paymentResult.settled,
      x402TxHash: paymentResult.settlementTxHash,
      costTxHash: economic.blockchainPayment?.costTxHash,
      escrowTxHash: economic.blockchainPayment?.escrowTxHash,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Task Delivery] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Execute mock task work (placeholder for real agent AI execution)
 */
function executeMockTaskWork(
  taskType: string,
  taskId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  switch (taskType) {
    case "CATALOG":
      return {
        action: "catalog_processing",
        taskId,
        output: {
          productsProcessed: 5,
          categoriesIdentified: 3,
          enrichmentScore: 0.92,
        },
      };
    case "REVIEW":
      return {
        action: "review_analysis",
        taskId,
        output: {
          reviewsAnalyzed: 150,
          averageSentiment: 0.78,
          summaryGenerated: true,
        },
      };
    case "CURATION":
      return {
        action: "curation_ranking",
        taskId,
        output: {
          itemsRanked: 25,
          collectionsCreated: 2,
          relevanceScore: 0.88,
        },
      };
    case "SELLER":
      return {
        action: "seller_operations",
        taskId,
        output: {
          quotesGenerated: 3,
          negotiationsCompleted: 1,
          conversionRate: 0.67,
        },
      };
    default:
      return {
        action: "generic_task",
        taskId,
        output: { completed: true },
      };
  }
}
