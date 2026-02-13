/**
 * Dividend Info API - GET /api/dividends/[agentId]
 *
 * Returns dividend information for an agent.
 * If wallet query param is provided, includes investor-specific data.
 *
 * Query params:
 *   ?wallet=0x... - Include investor's escrow balance and claim history
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       agent_id: string,
 *       agent_name: string,
 *       total_escrowed: number,
 *       total_claimed: number,
 *       escrow_deposit_count: number,
 *       investor?: {
 *         total_earned: number,
 *         total_claimed: number,
 *         available_to_claim: number,
 *         recent_claims: DividendClaimRecord[]
 *       }
 *     }
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { DividendClaimRecord } from "@/types/database";

interface RouteParams {
  params: Promise<{ agentId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { agentId } = await params;
  const wallet = request.nextUrl.searchParams.get("wallet");

  try {
    // 1. Get agent info
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, name, wallet_address, investor_share_bps")
      .eq("id", agentId)
      .single();

    if (agentError || !agent) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    // 2. Get agent's total escrow stats (aggregate)
    const { data: escrowStats, error: statsError } = await supabase
      .from("escrow_deposits")
      .select("investor_share_total")
      .eq("agent_id", agentId);

    if (statsError) {
      console.error("[Dividend Info] Error fetching escrow stats:", statsError);
    }

    const totalEscrowed = escrowStats?.reduce(
      (sum, d) => sum + Number(d.investor_share_total),
      0
    ) || 0;

    // 3. Get total claimed from all investors
    const { data: claimStats } = await supabase
      .from("dividend_claims")
      .select("amount")
      .eq("agent_id", agentId);

    const totalClaimed = claimStats?.reduce(
      (sum, c) => sum + Number(c.amount),
      0
    ) || 0;

    const escrowDepositCount = escrowStats?.length || 0;

    // 4. Get investor-specific data if wallet provided
    let investorData: {
      total_earned: number;
      total_claimed: number;
      available_to_claim: number;
      recent_claims: DividendClaimRecord[];
    } | null = null;

    if (wallet) {
      const normalizedWallet = wallet.toLowerCase();

      // Get investor's escrow balance (pre-calculated)
      const { data: escrow } = await supabase
        .from("investor_escrow")
        .select("total_earned, total_claimed, available_to_claim, last_deposit_at")
        .eq("agent_id", agentId)
        .eq("investor_wallet", normalizedWallet)
        .single();

      // Get recent claims for this investor
      const { data: claims } = await supabase
        .from("dividend_claims")
        .select("id, agent_id, investor_wallet, amount, tx_hash, claimed_at")
        .eq("agent_id", agentId)
        .eq("investor_wallet", normalizedWallet)
        .order("claimed_at", { ascending: false })
        .limit(10);

      investorData = {
        total_earned: Number(escrow?.total_earned || 0),
        total_claimed: Number(escrow?.total_claimed || 0),
        available_to_claim: Number(escrow?.available_to_claim || 0),
        recent_claims: (claims || []) as DividendClaimRecord[],
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        agent_id: agentId,
        agent_name: agent.name,
        investor_share_bps: agent.investor_share_bps || 7500,
        total_escrowed: totalEscrowed,
        total_claimed: totalClaimed,
        escrow_deposit_count: escrowDepositCount,
        investor: investorData,
      },
    });
  } catch (err) {
    console.error("[Dividend Info] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
