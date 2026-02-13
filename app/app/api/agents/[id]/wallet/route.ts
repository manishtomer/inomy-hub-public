import { NextResponse, NextRequest } from "next/server";
import { getAgentById } from "@/lib/api-helpers";
import { getAgentWalletInfo, getAgentWalletBalance } from "@/lib/privy-server";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/agents/[id]/wallet
 * Get wallet information for an agent
 *
 * Returns:
 * - wallet_address: The agent's wallet address
 * - privy_wallet_id: Privy wallet identifier
 * - privy_user_id: Privy user identifier
 * - balance: Current wallet balance in MON
 * - chain_id: Chain ID (10143 for Monad Testnet)
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Get agent from database
    const { data: agent, error } = await getAgentById(id);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    if (!agent) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    // Check if agent has a wallet
    if (!agent.wallet_address || !agent.privy_user_id) {
      return NextResponse.json(
        {
          success: false,
          error: "Agent does not have a wallet",
          message:
            "This agent was created before wallet integration. Please create a new agent or contact support.",
        },
        { status: 404 }
      );
    }

    // Get fresh wallet info from Privy (includes current balance)
    try {
      const walletInfo = await getAgentWalletInfo(agent.privy_user_id);

      return NextResponse.json({
        success: true,
        data: {
          agent_id: agent.id,
          agent_name: agent.name,
          wallet_address: walletInfo.wallet_address,
          privy_wallet_id: walletInfo.privy_wallet_id,
          privy_user_id: walletInfo.privy_user_id,
          balance: walletInfo.balance,
          chain_id: walletInfo.chain_id,
          chain_name: "Monad Testnet",
          explorer_url: `https://explorer.testnet.monad.xyz/address/${walletInfo.wallet_address}`,
        },
      });
    } catch (privyError) {
      // Fallback to database info if Privy fails
      console.error("Error fetching from Privy, using database info:", privyError);

      // Try to get balance directly via RPC
      let balance = "0.0";
      try {
        balance = await getAgentWalletBalance(agent.wallet_address);
      } catch (balanceError) {
        console.error("Failed to fetch balance:", balanceError);
      }

      return NextResponse.json({
        success: true,
        data: {
          agent_id: agent.id,
          agent_name: agent.name,
          wallet_address: agent.wallet_address,
          privy_wallet_id: agent.privy_wallet_id,
          privy_user_id: agent.privy_user_id,
          balance,
          chain_id: 10143,
          chain_name: "Monad Testnet",
          explorer_url: `https://explorer.testnet.monad.xyz/address/${agent.wallet_address}`,
        },
        warning: "Using cached wallet data",
      });
    }
  } catch (err) {
    console.error("Error fetching agent wallet:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
