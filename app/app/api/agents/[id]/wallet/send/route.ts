import { NextResponse, NextRequest } from "next/server";
import { getAgentById } from "@/lib/api-helpers";
import { sendAgentTransaction } from "@/lib/privy-server";
import type { SendTransactionRequest } from "@/types/database";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/agents/[id]/wallet/send
 * Send a transaction from an agent's wallet
 *
 * Body:
 * - to: Recipient address (required)
 * - value: Amount in ETH/MON, e.g., "0.1" (required)
 * - data: Optional calldata for contract interactions
 *
 * Returns:
 * - transaction_hash: The transaction hash
 * - status: Transaction status (pending, confirmed, failed)
 * - from: Sender address (agent's wallet)
 * - to: Recipient address
 * - value: Amount sent
 * - explorer_url: Link to view transaction on block explorer
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = (await request.json()) as SendTransactionRequest;

    // Validate required fields
    if (!body.to || !body.value) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields",
          message: "Both 'to' and 'value' are required",
        },
        { status: 400 }
      );
    }

    // Validate Ethereum address format
    if (!body.to.match(/^0x[a-fA-F0-9]{40}$/)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid recipient address",
          message: "Address must be a valid Ethereum address (0x...)",
        },
        { status: 400 }
      );
    }

    // Validate value format
    const valueNum = parseFloat(body.value);
    if (isNaN(valueNum) || valueNum <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid value",
          message: "Value must be a positive number",
        },
        { status: 400 }
      );
    }

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
    if (!agent.wallet_address || !agent.privy_wallet_id) {
      return NextResponse.json(
        {
          success: false,
          error: "Agent does not have a wallet",
          message:
            "This agent was created before wallet integration. Wallets cannot be added retroactively.",
        },
        { status: 404 }
      );
    }

    // Send transaction via Privy
    try {
      const txResult = await sendAgentTransaction(
        agent.privy_wallet_id,
        body.to,
        body.value,
        body.data
      );

      return NextResponse.json({
        success: true,
        data: {
          agent_id: agent.id,
          agent_name: agent.name,
          from: txResult.from,
          to: txResult.to,
          value: txResult.value,
          transaction_hash: txResult.transaction_hash,
          status: txResult.status,
          block_number: txResult.block_number,
          explorer_url: `https://explorer.testnet.monad.xyz/tx/${txResult.transaction_hash}`,
          chain_id: 10143,
          chain_name: "Monad Testnet",
        },
        message: "Transaction sent successfully",
      });
    } catch (txError) {
      console.error("Transaction failed:", txError);
      return NextResponse.json(
        {
          success: false,
          error: "Transaction failed",
          message: txError instanceof Error ? txError.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Error sending transaction:", err);
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
