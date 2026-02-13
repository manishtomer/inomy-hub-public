/**
 * Backfill Founder Tokens API
 *
 * POST /api/portfolio/backfill-founder?wallet=0x...
 *
 * Finds all agents created by a wallet and ensures their founder tokens
 * are recorded in token_holdings_cache.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet");

  if (!wallet) {
    return NextResponse.json(
      { success: false, error: "wallet parameter is required" },
      { status: 400 }
    );
  }

  const normalizedWallet = wallet.toLowerCase();

  try {
    // Find all agents where this wallet is the owner
    // Try multiple approaches since owner_wallet might not always be set
    let agents: any[] = [];

    // Approach 1: Check owner_wallet (case-insensitive)
    const { data: byOwner } = await supabase
      .from("agents")
      .select("id, name, wallet_address, owner_wallet, token_address, chain_agent_id")
      .or(`owner_wallet.ilike.${normalizedWallet},owner_wallet.ilike.${wallet}`);

    if (byOwner && byOwner.length > 0) {
      agents = byOwner;
    }

    // Approach 2: Check token_transactions for this wallet as investor
    if (agents.length === 0) {
      const { data: txAgents } = await supabase
        .from("token_transactions")
        .select("agent_id")
        .eq("investor_wallet", normalizedWallet)
        .eq("transaction_type", "BUY");

      if (txAgents && txAgents.length > 0) {
        const agentIds = [...new Set(txAgents.map(t => t.agent_id).filter(Boolean))];
        if (agentIds.length > 0) {
          const { data: foundAgents } = await supabase
            .from("agents")
            .select("id, name, wallet_address, owner_wallet, token_address, chain_agent_id")
            .in("id", agentIds);
          agents = foundAgents || [];
        }
      }
    }

    // Approach 3: Check existing token_holdings_cache
    if (agents.length === 0) {
      const { data: holdings } = await supabase
        .from("token_holdings_cache")
        .select("agent_id")
        .eq("investor_wallet", normalizedWallet);

      if (holdings && holdings.length > 0) {
        const agentIds = [...new Set(holdings.map(h => h.agent_id).filter(Boolean))];
        if (agentIds.length > 0) {
          const { data: foundAgents } = await supabase
            .from("agents")
            .select("id, name, wallet_address, owner_wallet, token_address, chain_agent_id")
            .in("id", agentIds);
          agents = foundAgents || [];
        }
      }
    }

    // Log for debugging
    console.log(`[Backfill] Found ${agents.length} agents for wallet ${normalizedWallet}`);

    if (agents.length === 0) {
      // Return helpful debug info - show all agents
      const { data: allAgents } = await supabase
        .from("agents")
        .select("id, name, owner_wallet, status, created_at")
        .order("created_at", { ascending: false })
        .limit(20);

      return NextResponse.json({
        success: true,
        message: "No agents found for this wallet. See debug.allAgents below.",
        backfilled: 0,
        debug: {
          searchedWallet: normalizedWallet,
          hint: "Find your agents in allAgents list, then call POST /api/portfolio/backfill-founder/add?agent_id=XXX&wallet=YYY",
          allAgents: allAgents?.map(a => ({
            id: a.id,
            name: a.name,
            owner_wallet: a.owner_wallet || "NOT SET",
            status: a.status,
            created: a.created_at,
          })),
        },
      });
    }

    const founderAllocation = 100;
    let backfilledCount = 0;
    const results: { agentId: string; name: string; status: string }[] = [];

    for (const agent of agents) {
      // Check if holding already exists
      const { data: existing } = await supabase
        .from("token_holdings_cache")
        .select("id, token_balance")
        .eq("investor_wallet", normalizedWallet)
        .eq("agent_id", agent.id)
        .single();

      if (existing) {
        results.push({
          agentId: agent.id,
          name: agent.name,
          status: `Already exists (${existing.token_balance} tokens)`,
        });
        continue;
      }

      // Insert founder token holding
      const { error: insertError } = await supabase
        .from("token_holdings_cache")
        .insert({
          investor_wallet: normalizedWallet,
          agent_wallet: agent.wallet_address?.toLowerCase() || "",
          agent_id: agent.id,
          token_balance: founderAllocation,
          total_invested: 0, // Founder tokens are FREE
          current_value: 0,
          unrealized_pnl: 0,
          unclaimed_dividends: 0,
          last_synced_block: 0,
        });

      if (insertError) {
        console.error(`[Backfill] Error for agent ${agent.id}:`, insertError);
        results.push({
          agentId: agent.id,
          name: agent.name,
          status: `Error: ${insertError.message}`,
        });
      } else {
        backfilledCount++;
        results.push({
          agentId: agent.id,
          name: agent.name,
          status: `Added ${founderAllocation} founder tokens`,
        });
        console.log(`[Backfill] Added founder tokens for ${agent.name} (${agent.id})`);
      }
    }

    return NextResponse.json({
      success: true,
      wallet: normalizedWallet,
      totalAgents: agents.length,
      backfilled: backfilledCount,
      results,
    });
  } catch (err) {
    console.error("[Backfill] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
