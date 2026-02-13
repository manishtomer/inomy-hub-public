/**
 * Claim All Dividends API
 *
 * POST /api/dividends/claim-all
 * Body: { investor_wallet: string }
 *
 * Claims ALL accumulated escrow balances across ALL agents in ONE transaction.
 * More gas-efficient than claiming per-agent.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { payDividendFromEscrow } from "@/lib/privy-server";
import { createEvent } from "@/lib/api-helpers";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { investor_wallet } = body;

    if (!investor_wallet) {
      return NextResponse.json(
        { success: false, error: "investor_wallet is required" },
        { status: 400 }
      );
    }

    const normalizedWallet = investor_wallet.toLowerCase();

    // Get all escrow balances for this investor with available_to_claim > 0
    const { data: escrows, error: escrowError } = await supabase
      .from("investor_escrow")
      .select("id, agent_id, total_earned, total_claimed, available_to_claim")
      .eq("investor_wallet", normalizedWallet)
      .gt("available_to_claim", 0);

    if (escrowError) {
      console.error("[Claim All] Error fetching escrows:", escrowError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch escrow balances" },
        { status: 500 }
      );
    }

    if (!escrows || escrows.length === 0) {
      return NextResponse.json(
        { success: false, error: "No dividends available to claim" },
        { status: 400 }
      );
    }

    // Calculate total amount to claim
    const totalAmount = escrows.reduce(
      (sum, e) => sum + Number(e.available_to_claim),
      0
    );

    if (totalAmount <= 0) {
      return NextResponse.json(
        { success: false, error: "No dividends available to claim" },
        { status: 400 }
      );
    }

    console.log(
      `[Claim All] Claiming $${totalAmount.toFixed(6)} USDC for ${normalizedWallet} from ${escrows.length} agents`
    );

    // Transfer total amount in ONE transaction
    const result = await payDividendFromEscrow(
      normalizedWallet,
      totalAmount,
      "claim-all" // agentId placeholder for logging
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    // Update all escrow records to mark as claimed
    const now = new Date().toISOString();
    const claimRecords: {
      agent_id: string;
      investor_wallet: string;
      amount: number;
      tx_hash: string | undefined;
    }[] = [];

    for (const escrow of escrows) {
      const claimAmount = Number(escrow.available_to_claim);

      // Update investor_escrow
      await supabase
        .from("investor_escrow")
        .update({
          total_claimed: Number(escrow.total_claimed) + claimAmount,
          last_claim_at: now,
          updated_at: now,
        })
        .eq("id", escrow.id);

      // Record claim for audit
      claimRecords.push({
        agent_id: escrow.agent_id,
        investor_wallet: normalizedWallet,
        amount: claimAmount,
        tx_hash: result.txHash,
      });
    }

    // Insert all claim records
    if (claimRecords.length > 0) {
      const { error: claimInsertError } = await supabase
        .from("dividend_claims")
        .insert(claimRecords);

      if (claimInsertError) {
        console.error("[Claim All] Failed to insert claim records:", claimInsertError);
      }
    }

    // Log economy event
    await createEvent({
      event_type: "dividend_claimed",
      description: `Investor claimed $${totalAmount.toFixed(6)} USDC dividends from ${escrows.length} agents`,
      amount: totalAmount,
      tx_hash: result.txHash,
      metadata: {
        investor_wallet: normalizedWallet,
        agent_count: escrows.length,
        agent_ids: escrows.map((e) => e.agent_id),
        currency: "USDC",
      },
    });

    console.log(
      `[Claim All] Success: $${totalAmount.toFixed(6)} USDC sent to ${normalizedWallet} (tx: ${result.txHash})`
    );

    return NextResponse.json({
      success: true,
      claimed: totalAmount,
      agentCount: escrows.length,
      txHash: result.txHash,
    });
  } catch (err) {
    console.error("[Claim All] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
