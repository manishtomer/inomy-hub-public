/**
 * Add Founder Tokens for a Specific Agent
 *
 * POST /api/portfolio/backfill-founder/add
 * Body: { agent_id: string, wallet: string }
 *
 * Manually adds founder tokens (100) for a specific agent to a wallet.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agent_id, wallet } = body;

    if (!agent_id || !wallet) {
      return NextResponse.json(
        { success: false, error: "agent_id and wallet are required" },
        { status: 400 }
      );
    }

    const normalizedWallet = wallet.toLowerCase();

    // Get agent details
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, name, wallet_address, token_address")
      .eq("id", agent_id)
      .single();

    if (agentError || !agent) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    // Check if holding already exists
    const { data: existing } = await supabase
      .from("token_holdings_cache")
      .select("id, token_balance")
      .eq("investor_wallet", normalizedWallet)
      .eq("agent_id", agent_id)
      .single();

    if (existing) {
      return NextResponse.json({
        success: true,
        message: `Holding already exists with ${existing.token_balance} tokens`,
        existing: true,
      });
    }

    const founderAllocation = 100;

    // Insert founder token holding
    const { error: insertError } = await supabase
      .from("token_holdings_cache")
      .insert({
        investor_wallet: normalizedWallet,
        agent_wallet: agent.wallet_address?.toLowerCase() || "",
        agent_id: agent_id,
        token_balance: founderAllocation,
        total_invested: 0,
        current_value: 0,
        unrealized_pnl: 0,
        unclaimed_dividends: 0,
        last_synced_block: 0,
      });

    if (insertError) {
      console.error("[Add Founder] Insert error:", insertError);
      return NextResponse.json(
        { success: false, error: insertError.message },
        { status: 500 }
      );
    }

    console.log(`[Add Founder] Added ${founderAllocation} tokens for ${agent.name} to ${normalizedWallet}`);

    return NextResponse.json({
      success: true,
      message: `Added ${founderAllocation} founder tokens for ${agent.name}`,
      agent: {
        id: agent.id,
        name: agent.name,
      },
      wallet: normalizedWallet,
      tokens: founderAllocation,
    });
  } catch (err) {
    console.error("[Add Founder] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
