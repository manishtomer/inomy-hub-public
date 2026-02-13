/**
 * Investment Transaction History API
 *
 * GET /api/investments/history?wallet=0x...
 *
 * Returns transaction history (buys and sells) for a wallet.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet");
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50");

  if (!wallet) {
    return NextResponse.json(
      { success: false, error: "wallet parameter is required" },
      { status: 400 }
    );
  }

  try {
    // Fetch transactions for this wallet
    const { data: transactions, error: txError } = await supabase
      .from("token_transactions")
      .select(`
        id,
        agent_id,
        agent_wallet,
        investor_wallet,
        transaction_type,
        token_amount,
        mon_amount,
        tx_hash,
        block_number,
        transacted_at,
        created_at
      `)
      .eq("investor_wallet", wallet.toLowerCase())
      .order("transacted_at", { ascending: false })
      .limit(limit);

    if (txError) {
      console.error("[History API] Error fetching transactions:", txError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch history" },
        { status: 500 }
      );
    }

    // Get agent details for each transaction
    const agentIds = [...new Set(transactions?.map(t => t.agent_id).filter(Boolean) || [])];

    let agents: Record<string, { name: string; token_symbol: string | null }> = {};

    if (agentIds.length > 0) {
      const { data: agentData } = await supabase
        .from("agents")
        .select("id, name, token_symbol")
        .in("id", agentIds);

      agents = (agentData || []).reduce((acc, a) => {
        acc[a.id] = { name: a.name, token_symbol: a.token_symbol };
        return acc;
      }, {} as Record<string, { name: string; token_symbol: string | null }>);
    }

    // Enrich transactions with agent info
    const enrichedTransactions = (transactions || []).map(tx => ({
      ...tx,
      agent_name: agents[tx.agent_id]?.name || "Unknown Agent",
      token_symbol: agents[tx.agent_id]?.token_symbol || "???",
    }));

    return NextResponse.json({
      success: true,
      data: {
        wallet: wallet.toLowerCase(),
        transactionCount: enrichedTransactions.length,
        transactions: enrichedTransactions,
      },
    });
  } catch (err) {
    console.error("[History API] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
