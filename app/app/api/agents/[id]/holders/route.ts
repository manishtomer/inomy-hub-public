/**
 * Agent Token Holders API
 *
 * GET /api/agents/[id]/holders
 *
 * Returns list of investors who hold tokens for this agent.
 * Data comes from token_holdings_cache (synced from chain events).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id: agentId } = await params;

  try {
    // Fetch agent to get wallet address
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, name, wallet_address, token_address")
      .eq("id", agentId)
      .single();

    if (agentError || !agent) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    // Fetch token holders from cache
    const { data: holdings, error: holdingsError } = await supabase
      .from("token_holdings_cache")
      .select("investor_wallet, token_balance, total_invested, current_value, unrealized_pnl, unclaimed_dividends, created_at")
      .eq("agent_id", agentId)
      .gt("token_balance", 0)
      .order("token_balance", { ascending: false });

    if (holdingsError) {
      console.error("[Holders API] Error fetching holdings:", holdingsError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch holders" },
        { status: 500 }
      );
    }

    // Calculate total tokens held and holder count
    const totalTokensHeld = holdings?.reduce((sum, h) => sum + Number(h.token_balance || 0), 0) || 0;
    const holderCount = holdings?.length || 0;

    return NextResponse.json({
      success: true,
      data: {
        agentId: agent.id,
        agentName: agent.name,
        tokenAddress: agent.token_address,
        holderCount,
        totalTokensHeld,
        holders: holdings || [],
      },
    });
  } catch (err) {
    console.error("[Holders API] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
