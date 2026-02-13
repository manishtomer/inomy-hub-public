/**
 * Record Token Sale API
 *
 * POST /api/investments/record-sale
 *
 * Records a token sale in the database.
 * Fallback for when chain sync isn't running.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

interface RecordSaleRequest {
  investor_wallet: string;
  agent_id: string;
  token_amount: string;
  mon_amount: string;
  tx_hash: string;
  block_number: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RecordSaleRequest;

    const {
      investor_wallet,
      agent_id,
      token_amount,
      mon_amount,
      tx_hash,
      block_number,
    } = body;

    if (!investor_wallet || !agent_id || !token_amount) {
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
        return NextResponse.json({
          success: true,
          message: "Sale already recorded",
        });
      }
    }

    // Get existing holding
    const { data: existingHolding } = await supabase
      .from("token_holdings_cache")
      .select("id, token_balance, agent_wallet")
      .eq("investor_wallet", investor_wallet.toLowerCase())
      .eq("agent_id", agent_id)
      .single();

    if (!existingHolding) {
      return NextResponse.json(
        { success: false, error: "No holding found for this agent" },
        { status: 404 }
      );
    }

    const newBalance = Math.max(0, Number(existingHolding.token_balance) - tokenAmountNum);

    // Update holding (decrease balance)
    if (newBalance > 0) {
      const { error: updateError } = await supabase
        .from("token_holdings_cache")
        .update({
          token_balance: newBalance,
          last_synced_block: block_number,
        })
        .eq("id", existingHolding.id);

      if (updateError) {
        console.error("[Record Sale] Update error:", updateError);
      }
    } else {
      // Delete holding if balance is 0
      const { error: deleteError } = await supabase
        .from("token_holdings_cache")
        .delete()
        .eq("id", existingHolding.id);

      if (deleteError) {
        console.error("[Record Sale] Delete error:", deleteError);
      }
    }

    // Record the transaction
    if (tx_hash) {
      const { error: txError } = await supabase
        .from("token_transactions")
        .insert({
          agent_id: agent_id,
          agent_wallet: existingHolding.agent_wallet || "",
          investor_wallet: investor_wallet.toLowerCase(),
          transaction_type: "SELL",
          token_amount: tokenAmountNum,
          mon_amount: monAmountNum,
          tx_hash: tx_hash,
          block_number: block_number,
          transacted_at: new Date().toISOString(),
        });

      if (txError) {
        console.error("[Record Sale] Transaction record error:", txError);
      }
    }

    console.log(
      `[Record Sale] ${investor_wallet.slice(0, 10)} sold ${tokenAmountNum} tokens for ${monAmountNum} MON from agent ${agent_id.slice(0, 8)}`
    );

    return NextResponse.json({
      success: true,
      message: "Sale recorded",
      newBalance,
    });
  } catch (err) {
    console.error("[Record Sale] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
