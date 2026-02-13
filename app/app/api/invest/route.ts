/**
 * Investment API - Buy/Sell Agent Tokens
 *
 * POST /api/invest - Buy agent tokens
 * Body: { agentId, tokenAmount, investorWallet }
 *
 * This endpoint:
 * 1. Gets the agent's token address from database
 * 2. Calculates the cost (bonding curve + fee)
 * 3. Returns transaction data for the user to sign
 *
 * Note: The actual transaction is signed by the user's wallet on the frontend.
 * This API prepares the transaction data.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getTokenInfo,
  calculatePurchaseCost,
  calculateSaleReturn,
  getTokenBalance,
  AGENT_TOKEN_ABI,
  formatMON,
  getExplorerAddressUrl,
} from "@/lib/contracts";
import type { Address } from "viem";
import { encodeFunctionData } from "viem";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface InvestRequest {
  agentId: string;
  tokenAmount: string; // Amount of tokens to buy (in wei)
  investorWallet: string;
  action: "buy" | "sell" | "quote";
}

/**
 * POST /api/invest
 * Prepare investment transaction or get quote
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as InvestRequest;

    // Validate required fields
    if (!body.agentId || !body.tokenAmount || !body.investorWallet) {
      return NextResponse.json(
        { success: false, error: "agentId, tokenAmount, and investorWallet are required" },
        { status: 400 }
      );
    }

    const action = body.action || "quote";

    // Get agent from database
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("*")
      .eq("id", body.agentId)
      .single();

    if (agentError || !agent) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    // Check if agent has token address
    if (!agent.token_address) {
      return NextResponse.json(
        { success: false, error: "Agent is not registered on blockchain yet" },
        { status: 400 }
      );
    }

    const tokenAddress = agent.token_address as Address;
    const tokenAmount = BigInt(body.tokenAmount);
    const investorWallet = body.investorWallet as Address;

    // Get token info
    const tokenInfo = await getTokenInfo(tokenAddress);

    if (action === "buy" || action === "quote") {
      // Calculate purchase cost
      const cost = await calculatePurchaseCost(tokenAddress, tokenAmount);
      const fee = (cost * tokenInfo.protocolFeeBps) / 10000n;
      const totalCost = cost + fee;

      // Get current balance
      const currentBalance = await getTokenBalance(tokenAddress, investorWallet);

      // If just a quote, return the info
      if (action === "quote") {
        return NextResponse.json({
          success: true,
          action: "quote",
          agent: {
            id: agent.id,
            name: agent.name,
            type: agent.type,
            token_address: tokenAddress,
          },
          quote: {
            tokenAmount: tokenAmount.toString(),
            tokenAmountFormatted: formatMON(tokenAmount),
            cost: cost.toString(),
            costFormatted: formatMON(cost),
            fee: fee.toString(),
            feeFormatted: formatMON(fee),
            totalCost: totalCost.toString(),
            totalCostFormatted: formatMON(totalCost),
            currentPrice: tokenInfo.currentPrice.toString(),
            currentPriceFormatted: formatMON(tokenInfo.currentPrice),
            totalSupply: tokenInfo.totalSupply.toString(),
            protocolFeeBps: Number(tokenInfo.protocolFeeBps),
          },
          investor: {
            wallet: investorWallet,
            currentTokenBalance: currentBalance.toString(),
            currentTokenBalanceFormatted: formatMON(currentBalance),
          },
        });
      }

      // For buy action, prepare transaction data
      const txData = encodeFunctionData({
        abi: AGENT_TOKEN_ABI,
        functionName: "buyExact",
        args: [tokenAmount],
      });

      return NextResponse.json({
        success: true,
        action: "buy",
        transaction: {
          to: tokenAddress,
          data: txData,
          value: totalCost.toString(),
          chainId: 10143,
        },
        quote: {
          tokenAmount: tokenAmount.toString(),
          totalCost: totalCost.toString(),
          totalCostFormatted: formatMON(totalCost),
        },
        explorerUrl: getExplorerAddressUrl(tokenAddress),
      });
    } else if (action === "sell") {
      // Calculate sale return
      const returnAmount = await calculateSaleReturn(tokenAddress, tokenAmount);
      const currentBalance = await getTokenBalance(tokenAddress, investorWallet);

      // Check if user has enough tokens
      if (currentBalance < tokenAmount) {
        return NextResponse.json(
          {
            success: false,
            error: "Insufficient token balance",
            balance: currentBalance.toString(),
            requested: tokenAmount.toString(),
          },
          { status: 400 }
        );
      }

      // Prepare sell transaction (with 0 minRefund - user should set slippage on frontend)
      const txData = encodeFunctionData({
        abi: AGENT_TOKEN_ABI,
        functionName: "sell",
        args: [tokenAmount, BigInt(0)],
      });

      return NextResponse.json({
        success: true,
        action: "sell",
        transaction: {
          to: tokenAddress,
          data: txData,
          value: "0",
          chainId: 10143,
        },
        quote: {
          tokenAmount: tokenAmount.toString(),
          returnAmount: returnAmount.toString(),
          returnAmountFormatted: formatMON(returnAmount),
        },
        explorerUrl: getExplorerAddressUrl(tokenAddress),
      });
    }

    return NextResponse.json(
      { success: false, error: "Invalid action. Use 'buy', 'sell', or 'quote'" },
      { status: 400 }
    );
  } catch (err) {
    console.error("Investment API error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/invest?agentId=xxx&wallet=xxx
 * Get investment info for an agent
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const agentId = searchParams.get("agentId");
    const wallet = searchParams.get("wallet");

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: "agentId is required" },
        { status: 400 }
      );
    }

    // Get agent from database
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .single();

    if (agentError || !agent) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    if (!agent.token_address) {
      return NextResponse.json({
        success: true,
        agent: {
          id: agent.id,
          name: agent.name,
          type: agent.type,
          status: agent.status,
        },
        blockchain: {
          registered: false,
          message: "Agent is not registered on blockchain yet",
        },
      });
    }

    const tokenAddress = agent.token_address as Address;

    // Get token info
    const tokenInfo = await getTokenInfo(tokenAddress);

    // Get investor balance if wallet provided
    let investorBalance = 0n;
    if (wallet) {
      investorBalance = await getTokenBalance(tokenAddress, wallet as Address);
    }

    return NextResponse.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        type: agent.type,
        status: agent.status,
        chain_agent_id: agent.chain_agent_id,
      },
      token: {
        address: tokenAddress,
        currentPrice: tokenInfo.currentPrice.toString(),
        currentPriceFormatted: formatMON(tokenInfo.currentPrice),
        totalSupply: tokenInfo.totalSupply.toString(),
        totalSupplyFormatted: formatMON(tokenInfo.totalSupply),
        protocolFeeBps: Number(tokenInfo.protocolFeeBps),
        explorerUrl: getExplorerAddressUrl(tokenAddress),
      },
      investor: wallet
        ? {
            wallet: wallet,
            tokenBalance: investorBalance.toString(),
            tokenBalanceFormatted: formatMON(investorBalance),
          }
        : null,
    });
  } catch (err) {
    console.error("Investment info API error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
