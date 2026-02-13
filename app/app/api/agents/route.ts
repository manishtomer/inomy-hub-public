import { NextResponse, NextRequest } from "next/server";
import { createAgent, updateAgentWallet } from "@/lib/api-helpers";
import { createAgentWithWallet } from "@/lib/privy-server";
import { supabase } from "@/lib/supabase";
import type { CreateAgentRequest, AgentPersonality } from "@/types/database";
import { createClient } from "@supabase/supabase-js";
import { prepareTokenCreation } from "@/lib/nadfun";
import { REGISTRATION_FEE_USDC } from "@/lib/platform-config";

/**
 * Validate token symbol: max 6 chars, uppercase letters only
 */
function validateTokenSymbol(symbol: string): { valid: boolean; error?: string } {
  if (!symbol || symbol.length === 0) {
    return { valid: false, error: "Token symbol is required" };
  }
  if (symbol.length > 6) {
    return { valid: false, error: "Token symbol must be 6 characters or less" };
  }
  if (!/^[A-Z]+$/.test(symbol)) {
    return { valid: false, error: "Token symbol must be uppercase letters only (A-Z)" };
  }
  return { valid: true };
}

/**
 * GET /api/agents
 * Fetch all agents with optional limit
 * Query params: limit (number)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!)
      : undefined;

    // Only fetch nad.fun agents that completed the full creation flow
    // (have pool address + are not UNFUNDED/DEAD)
    let query = supabase
      .from("agents")
      .select("*")
      .not("nadfun_pool_address", "is", null)
      .not("status", "in", "(UNFUNDED,DEAD)")
      .order("created_at", { ascending: false });

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { success: false, error: `Failed to fetch agents: ${error.message}` },
        { status: 500 }
      );
    }

    const nadFunAgents = data || [];

    // Get bid counts for all agents (use individual count queries to avoid Supabase row limit)
    const agentIds = nadFunAgents.map((a: { id: string }) => a.id);
    const bidCountResults = await Promise.all(
      agentIds.map((id: string) =>
        supabase
          .from("bids_cache")
          .select("id", { count: "exact", head: true })
          .eq("agent_id", id)
          .then(r => ({ id, count: r.count || 0 }))
      )
    );

    const bidCountMap = new Map<string, number>();
    bidCountResults.forEach(r => bidCountMap.set(r.id, r.count));

    // Add total_bids to each agent
    const agentsWithBids = nadFunAgents.map((agent: { id: string }) => ({
      ...agent,
      total_bids: bidCountMap.get(agent.id) || 0,
    }));

    // Sort: PLATFORM first, then ACTIVE, then by balance descending
    const statusOrder: Record<string, number> = { ACTIVE: 0, LOW_FUNDS: 1, UNFUNDED: 2, DEAD: 3 };
    agentsWithBids.sort((a, b) => {
      // Platform token always first
      if ((a as any).type === 'PLATFORM') return -1;
      if ((b as any).type === 'PLATFORM') return 1;
      const statusDiff = (statusOrder[(a as any).status || 'DEAD'] ?? 9) - (statusOrder[(b as any).status || 'DEAD'] ?? 9);
      if (statusDiff !== 0) return statusDiff;
      return ((b as any).balance || 0) - ((a as any).balance || 0);
    });

    return NextResponse.json({
      success: true,
      count: agentsWithBids.length,
      data: agentsWithBids,
      source: "database",
    });
  } catch (err) {
    console.error("Error fetching agents:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/agents
 * Create a new agent with embedded wallet + prepare nad.fun token TX
 *
 * Flow (3 user interactions):
 * 1. POST /api/agents → DB + Privy wallet + prepare nad.fun TX → return TX data
 * 2. User signs nad.fun BondingCurveRouter.create() TX (pays MON)
 * 3. POST /api/agents/[id]/confirm → parse CurveCreate event, store token data
 * 4. User signs USDC seed transfer
 * 5. POST /api/agents/[id]/confirm → marks ACTIVE
 *
 * Body: CreateAgentRequest + ownerWallet + symbol + personality + initialBuyAmount
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateAgentRequest & {
      ownerWallet?: string;
      symbol?: string;
      personality?: AgentPersonality;
      description?: string;
      initialBuyAmount?: string; // MON for initial token buy (default "0.1")
    };

    // Validate required fields
    if (!body.name || !body.type) {
      return NextResponse.json(
        { success: false, error: "Name and type are required" },
        { status: 400 }
      );
    }

    if (!body.ownerWallet) {
      return NextResponse.json(
        { success: false, error: "ownerWallet is required - the wallet that will own this agent" },
        { status: 400 }
      );
    }

    // Validate token symbol if provided
    if (body.symbol) {
      const symbolValidation = validateTokenSymbol(body.symbol);
      if (!symbolValidation.valid) {
        return NextResponse.json(
          { success: false, error: symbolValidation.error },
          { status: 400 }
        );
      }
    }

    // Validate personality if provided
    const validPersonalities: AgentPersonality[] = ["conservative", "balanced", "aggressive", "opportunistic"];
    const personality: AgentPersonality = body.personality && validPersonalities.includes(body.personality)
      ? body.personality
      : "balanced";

    // Use provided symbol or auto-generate from name
    const symbol = body.symbol
      ? body.symbol.toUpperCase()
      : body.name
          .split(" ")
          .map((w) => w[0])
          .join("")
          .toUpperCase()
          .slice(0, 4) + Math.floor(Math.random() * 100);

    // Step 1: Create the agent in database
    console.log("[Agent Creation] Step 1: Creating agent in database...");
    const { data: agent, error } = await createAgent(body);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    if (!agent) {
      return NextResponse.json(
        { success: false, error: "Failed to create agent" },
        { status: 500 }
      );
    }

    console.log(`[Agent Creation] Database agent created: ${agent.id}`);

    // Step 2: Create embedded wallet via Privy (agent's operational wallet)
    let agentWalletAddress: string | null = null;
    let privyWalletId: string | null = null;
    let privyUserId: string | null = null;

    try {
      console.log("[Agent Creation] Step 2: Creating Privy wallet for agent...");
      const walletInfo = await createAgentWithWallet(agent.id, agent.name);
      agentWalletAddress = walletInfo.wallet_address;
      privyWalletId = walletInfo.privy_wallet_id;
      privyUserId = walletInfo.privy_user_id;

      await updateAgentWallet(agent.id, {
        wallet_address: agentWalletAddress,
        privy_wallet_id: privyWalletId,
        privy_user_id: privyUserId,
      });

      console.log(`[Agent Creation] Privy wallet created: ${agentWalletAddress}`);
    } catch (walletError) {
      console.error("[Agent Creation] Privy wallet creation failed:", walletError);
    }

    // Step 3: Prepare nad.fun token creation TX (user signs this)
    let transaction: {
      to: string;
      data: string;
      value: string;
      chainId: number;
    } | null = null;
    let predictedTokenAddress: string | null = null;

    try {
      console.log("[Agent Creation] Step 3: Preparing nad.fun token creation TX...");
      const tokenCreationTx = await prepareTokenCreation({
        name: body.name,
        symbol,
        description: body.description || `${body.name} - AI Agent on Inomy`,
        creatorWallet: body.ownerWallet,
        initialBuyAmount: body.initialBuyAmount || "0.1",
      });

      transaction = {
        to: tokenCreationTx.to,
        data: tokenCreationTx.data,
        value: tokenCreationTx.value,
        chainId: tokenCreationTx.chainId,
      };
      predictedTokenAddress = tokenCreationTx.predictedTokenAddress;

      console.log(`[Agent Creation] TX prepared. Predicted token: ${predictedTokenAddress}`);
    } catch (tokenError) {
      console.error("[Agent Creation] nad.fun TX preparation failed:", tokenError);
      // Don't fail the whole request — agent is created, token TX can be retried
    }

    // Step 4: Update agent record with owner + personality + symbol
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    await db
      .from("agents")
      .update({
        owner_wallet: body.ownerWallet,
        personality,
        token_symbol: symbol,
        status: "UNFUNDED",
      })
      .eq("id", agent.id);

    return NextResponse.json(
      {
        success: true,
        data: {
          ...agent,
          wallet_address: agentWalletAddress,
          owner_wallet: body.ownerWallet,
          personality,
          token_symbol: symbol,
          status: "UNFUNDED",
        },
        wallet: agentWalletAddress
          ? { address: agentWalletAddress, privy_wallet_id: privyWalletId }
          : null,
        transaction,
        nadfun: predictedTokenAddress
          ? { predicted_token_address: predictedTokenAddress }
          : null,
        registrationFee: REGISTRATION_FEE_USDC,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Error creating agent:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
