import { NextResponse, NextRequest } from "next/server";
import { getAllHoldings, createHolding } from "@/lib/api-helpers";
import type { CreateInvestmentRequest } from "@/types/database";

/**
 * GET /api/holdings
 * Fetch all holdings with optional filters
 * Query params: investor (wallet_address), agent (wallet_address), limit (number)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const investorWallet = searchParams.get("investor");
    const agentWallet = searchParams.get("agent");
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!)
      : undefined;

    const { data, error } = await getAllHoldings({
      investor_wallet: investorWallet || undefined,
      agent_wallet: agentWallet || undefined,
      limit,
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: `Failed to fetch holdings: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      data: data || [],
      source: "database",
    });
  } catch (err) {
    console.error("Error fetching holdings:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/holdings
 * Create a new holding (invest in an agent)
 * Body: CreateInvestmentRequest
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateInvestmentRequest;

    // Validate required fields
    if (!body.investor_wallet || !body.agent_wallet || !body.amount) {
      return NextResponse.json(
        {
          success: false,
          error: "investor_wallet, agent_wallet, and amount are required"
        },
        { status: 400 }
      );
    }

    // Validate amount is positive
    if (body.amount <= 0) {
      return NextResponse.json(
        { success: false, error: "Investment amount must be positive" },
        { status: 400 }
      );
    }

    // Create the holding
    const { data, error } = await createHolding({
      investor_wallet: body.investor_wallet,
      agent_wallet: body.agent_wallet,
      token_balance: body.amount, // In demo mode, 1:1 token to investment
      total_invested: body.amount,
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (err) {
    console.error("Error creating holding:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
