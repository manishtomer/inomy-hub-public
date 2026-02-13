/**
 * Dividend Claim API - POST /api/dividends/claim
 *
 * Claims an investor's accumulated escrow balance for an agent.
 * The claimable amount is pre-calculated and stored in investor_escrow table.
 *
 * Request body:
 *   { agent_id: string, investor_wallet: string }
 *
 * Response:
 *   { success: true, claimed: number, txHash: string }
 *   { success: false, error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { payDividendFromEscrow } from "@/lib/privy-server";
import { createEvent } from "@/lib/api-helpers";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agent_id, investor_wallet } = body;

    // Validate input
    if (!agent_id || !investor_wallet) {
      return NextResponse.json(
        { success: false, error: "agent_id and investor_wallet are required" },
        { status: 400 }
      );
    }

    const normalizedWallet = investor_wallet.toLowerCase();

    // 1. Get investor's escrow balance (already calculated in DB)
    const { data: escrow, error: escrowError } = await supabase
      .from("investor_escrow")
      .select("id, available_to_claim, total_earned, total_claimed")
      .eq("agent_id", agent_id)
      .eq("investor_wallet", normalizedWallet)
      .single();

    if (escrowError && escrowError.code !== "PGRST116") {
      // PGRST116 = no rows found (which we handle below)
      console.error("[Dividend Claim] Error fetching escrow:", escrowError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch escrow balance" },
        { status: 500 }
      );
    }

    // Check if there's anything to claim
    const availableToClaim = Number(escrow?.available_to_claim || 0);
    if (availableToClaim <= 0) {
      return NextResponse.json(
        { success: false, error: "No dividends available to claim" },
        { status: 400 }
      );
    }

    // Minimum claim amount
    const MINIMUM_CLAIM = 0.000001;
    if (availableToClaim < MINIMUM_CLAIM) {
      return NextResponse.json(
        { success: false, error: `Amount too small. Minimum: ${MINIMUM_CLAIM} USDC` },
        { status: 400 }
      );
    }

    // 2. Get agent info for logging
    const { data: agent } = await supabase
      .from("agents")
      .select("id, name, wallet_address")
      .eq("id", agent_id)
      .single();

    if (!agent) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    // 3. Transfer from escrow wallet to investor
    const result = await payDividendFromEscrow(
      investor_wallet, // Use original case for the actual transfer
      availableToClaim,
      agent_id
    );

    if (!result.success) {
      console.error("[Dividend Claim] Transfer failed:", result.error);
      return NextResponse.json(
        { success: false, error: result.error || "Transfer failed" },
        { status: 500 }
      );
    }

    // 4. Update investor's escrow (mark as claimed)
    const newTotalClaimed = Number(escrow?.total_claimed || 0) + availableToClaim;
    const { error: updateError } = await supabase
      .from("investor_escrow")
      .update({
        total_claimed: newTotalClaimed,
        last_claim_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", escrow!.id);

    if (updateError) {
      // Log but don't fail - the transfer already succeeded
      console.error("[Dividend Claim] Failed to update escrow record:", updateError);
    }

    // 5. Record claim for audit
    const { error: claimError } = await supabase.from("dividend_claims").insert({
      agent_id,
      investor_wallet: normalizedWallet,
      amount: availableToClaim,
      tx_hash: result.txHash,
    });

    if (claimError) {
      console.error("[Dividend Claim] Failed to record claim:", claimError);
    }

    // 6. Log economy event
    const eventResult = await createEvent({
      event_type: "dividend_claimed",
      description: `Investor claimed $${availableToClaim.toFixed(6)} USDC dividend from ${agent.name}`,
      agent_wallets: agent.wallet_address ? [agent.wallet_address] : [],
      investor_wallet: normalizedWallet,
      amount: availableToClaim,
      tx_hash: result.txHash,
      metadata: {
        agent_id,
        agent_name: agent.name,
        claim_amount: availableToClaim,
        currency: "USDC",
      },
    });

    if (eventResult.error) {
      console.error("[Dividend Claim] Failed to log event:", eventResult.error);
    }

    console.log(
      `[Dividend Claim] ${normalizedWallet} claimed $${availableToClaim.toFixed(6)} USDC from ${agent.name} (tx: ${result.txHash})`
    );

    return NextResponse.json({
      success: true,
      claimed: availableToClaim,
      txHash: result.txHash,
    });
  } catch (err) {
    console.error("[Dividend Claim] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
