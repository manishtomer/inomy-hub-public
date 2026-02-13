/**
 * User Portfolio API
 *
 * GET /api/portfolio?wallet=0x...
 *
 * Returns all token holdings for a given wallet address.
 * Data comes from token_holdings_cache (synced from chain events).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet");

  if (!wallet) {
    return NextResponse.json(
      { success: false, error: "wallet parameter is required" },
      { status: 400 }
    );
  }

  try {
    // Fetch all holdings for this wallet
    const { data: holdings, error: holdingsError } = await supabase
      .from("token_holdings_cache")
      .select(`
        investor_wallet,
        agent_wallet,
        agent_id,
        token_balance,
        total_invested,
        current_value,
        unrealized_pnl,
        unclaimed_dividends,
        created_at
      `)
      .eq("investor_wallet", wallet.toLowerCase())
      .gt("token_balance", 0)
      .order("token_balance", { ascending: false });

    if (holdingsError) {
      console.error("[Portfolio API] Error fetching holdings:", holdingsError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch portfolio" },
        { status: 500 }
      );
    }

    // Get agent details for each holding
    const agentIds = holdings?.map(h => h.agent_id).filter(Boolean) || [];

    let agents: Record<string, { name: string; token_symbol: string | null; token_address: string | null; status: string; nadfun_pool_address: string | null }> = {};

    if (agentIds.length > 0) {
      const { data: agentData } = await supabase
        .from("agents")
        .select("id, name, token_symbol, token_address, status, nadfun_pool_address")
        .in("id", agentIds);

      agents = (agentData || []).reduce((acc, a) => {
        acc[a.id] = { name: a.name, token_symbol: a.token_symbol, token_address: a.token_address, status: a.status, nadfun_pool_address: a.nadfun_pool_address };
        return acc;
      }, {} as Record<string, { name: string; token_symbol: string | null; token_address: string | null; status: string; nadfun_pool_address: string | null }>);
    }

    // Enrich holdings with agent info — only include nad.fun tokens
    const enrichedHoldings = (holdings || [])
      .filter(h => agents[h.agent_id]?.nadfun_pool_address)
      .map(h => ({
        ...h,
        agent_name: agents[h.agent_id]?.name || "Unknown Agent",
        token_symbol: agents[h.agent_id]?.token_symbol || "???",
        token_address: agents[h.agent_id]?.token_address,
        agent_status: agents[h.agent_id]?.status || "UNKNOWN",
      }));

    // Calculate totals
    const totalInvested = enrichedHoldings.reduce((sum, h) => sum + Number(h.total_invested || 0), 0);
    const totalValue = enrichedHoldings.reduce((sum, h) => sum + Number(h.current_value || 0), 0);
    const totalPnl = enrichedHoldings.reduce((sum, h) => sum + Number(h.unrealized_pnl || 0), 0);
    const totalUnclaimed = enrichedHoldings.reduce((sum, h) => sum + Number(h.unclaimed_dividends || 0), 0);

    return NextResponse.json({
      success: true,
      data: {
        wallet: wallet.toLowerCase(),
        holdingCount: enrichedHoldings.length,
        totalInvested,
        totalValue,
        totalPnl,
        totalUnclaimedDividends: totalUnclaimed,
        holdings: enrichedHoldings,
      },
    });
  } catch (err) {
    console.error("[Portfolio API] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
