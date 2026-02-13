/**
 * Record Investment API
 *
 * POST /api/investments/record
 *
 * Records a token purchase in the database.
 * This is a fallback for when chain sync isn't running.
 * The chain sync will eventually pick up the event and update/dedupe.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

interface RecordInvestmentRequest {
  investor_wallet: string;
  agent_id: string;
  agent_wallet: string;
  token_amount: string;
  mon_amount: string;
  tx_hash: string;
  block_number: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RecordInvestmentRequest;

    const {
      investor_wallet,
      agent_id,
      agent_wallet,
      token_amount,
      mon_amount,
      tx_hash,
      block_number,
    } = body;

    if (!investor_wallet || !agent_id || !token_amount || !mon_amount) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const tokenAmountNum = parseFloat(token_amount);
    const monAmountNum = parseFloat(mon_amount);

    // Check if this transaction was already recorded
    if (tx_hash) {
      const { data: existingTx } = await supabase
        .from("token_transactions")
        .select("id")
        .eq("tx_hash", tx_hash)
        .single();

      if (existingTx) {
        // Already recorded, return success
        return NextResponse.json({
          success: true,
          message: "Investment already recorded",
        });
      }
    }

    // Upsert token_holdings_cache
    // First check if holding exists
    const { data: existingHolding } = await supabase
      .from("token_holdings_cache")
      .select("id, token_balance, total_invested")
      .eq("investor_wallet", investor_wallet.toLowerCase())
      .eq("agent_id", agent_id)
      .single();

    if (existingHolding) {
      // Update existing holding (add to balance)
      const { error: updateError } = await supabase
        .from("token_holdings_cache")
        .update({
          token_balance: Number(existingHolding.token_balance) + tokenAmountNum,
          total_invested: Number(existingHolding.total_invested) + monAmountNum,
          last_synced_block: block_number,
        })
        .eq("id", existingHolding.id);

      if (updateError) {
        console.error("[Record Investment] Update error:", updateError);
      }
    } else {
      // Insert new holding
      const { error: insertError } = await supabase
        .from("token_holdings_cache")
        .insert({
          investor_wallet: investor_wallet.toLowerCase(),
          agent_wallet: agent_wallet?.toLowerCase() || "",
          agent_id: agent_id,
          token_balance: tokenAmountNum,
          total_invested: monAmountNum,
          current_value: 0,
          unrealized_pnl: 0,
          unclaimed_dividends: 0,
          last_synced_block: block_number,
        });

      if (insertError) {
        console.error("[Record Investment] Insert error:", insertError);
        return NextResponse.json(
          { success: false, error: "Failed to record holding" },
          { status: 500 }
        );
      }
    }

    // Record the transaction
    if (tx_hash) {
      const { error: txError } = await supabase
        .from("token_transactions")
        .insert({
          agent_id: agent_id,
          agent_wallet: agent_wallet?.toLowerCase() || "",
          investor_wallet: investor_wallet.toLowerCase(),
          transaction_type: "BUY",
          token_amount: tokenAmountNum,
          mon_amount: monAmountNum,
          tx_hash: tx_hash,
          block_number: block_number,
          transacted_at: new Date().toISOString(),
        });

      if (txError) {
        console.error("[Record Investment] Transaction record error:", txError);
        // Don't fail - holding was recorded
      }
    }

    console.log(
      `[Record Investment] ${investor_wallet.slice(0, 10)} invested ${monAmountNum} MON for ${tokenAmountNum} tokens in agent ${agent_id.slice(0, 8)}`
    );

    return NextResponse.json({
      success: true,
      message: "Investment recorded",
    });
  } catch (err) {
    console.error("[Record Investment] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
