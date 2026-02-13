import { NextResponse, NextRequest } from "next/server";
import { getInvestorById, getAllHoldings, getAllAgents } from "@/lib/api-helpers";
import type { InvestorPortfolio, TokenHolding, Agent } from "@/types/database";

/**
 * GET /api/investors/[id]/portfolio
 * Get investor portfolio with P&L calculations
 * Returns holdings with current value and profit/loss
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Fetch investor details
    const { data: investor, error: investorError } = await getInvestorById(id);

    if (investorError) {
      return NextResponse.json(
        { success: false, error: investorError.message },
        { status: 400 }
      );
    }

    if (!investor) {
      return NextResponse.json(
        { success: false, error: "Investor not found" },
        { status: 404 }
      );
    }

    // Fetch holdings for this investor
    const { data: holdings, error: holdingsError } = await getAllHoldings({
      investor_wallet: investor.wallet_address,
    });

    if (holdingsError) {
      return NextResponse.json(
        { success: false, error: holdingsError.message },
        { status: 400 }
      );
    }

    // Fetch all agents to calculate current values
    const { data: agents, error: agentsError } = await getAllAgents();

    if (agentsError) {
      return NextResponse.json(
        { success: false, error: agentsError.message },
        { status: 400 }
      );
    }

    // Build agent wallet to agent map
    const agentMap = new Map<string, Agent>();
    const safeAgents = (agents && Array.isArray(agents)) ? (agents as unknown as Agent[]) : [];
    safeAgents.forEach((agent) => {
      agentMap.set(`wallet-${agent.id}`, agent);
    });

    // Calculate P&L for each holding
    const enrichedHoldings = (holdings || []).map((holding: TokenHolding) => {
      const agent = agentMap.get(holding.agent_wallet);

      if (!agent) {
        return {
          ...holding,
          agent_name: "Unknown Agent",
          current_value: 0,
          pnl: 0,
          pnl_percent: 0,
        };
      }

      // Current value = agent.balance * (holding.token_balance / agent's total supply)
      // Note: We don't have total_supply in the schema, so we'll use token_price as proxy
      // current_value = holding.token_balance * agent.token_price
      const currentValue = holding.token_balance * agent.token_price;
      const pnl = currentValue - holding.total_invested;
      const pnlPercent = holding.total_invested > 0
        ? (pnl / holding.total_invested) * 100
        : 0;

      return {
        ...holding,
        agent_name: agent.name,
        current_value: currentValue,
        pnl,
        pnl_percent: pnlPercent,
      };
    });

    // Calculate portfolio totals
    const totalInvested = enrichedHoldings.reduce(
      (sum, h) => sum + h.total_invested,
      0
    );
    const currentValue = enrichedHoldings.reduce(
      (sum, h) => sum + h.current_value,
      0
    );
    const pnlPercent = totalInvested > 0
      ? ((currentValue - totalInvested) / totalInvested) * 100
      : 0;

    const portfolio: InvestorPortfolio = {
      investor,
      holdings: enrichedHoldings,
      total_invested: totalInvested,
      current_value: currentValue,
      pnl_percent: pnlPercent,
      total_unclaimed_dividends: 0,
    };

    return NextResponse.json({ success: true, data: portfolio });
  } catch (err) {
    console.error("Error fetching investor portfolio:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
