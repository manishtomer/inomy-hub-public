/**
 * Agent Token Details API
 *
 * GET /api/agents/[id]/token
 *
 * Returns token information for nad.fun bonding curve tokens:
 * - Symbol, name (from ERC20)
 * - Total supply
 * - Current price (from nad.fun Lens)
 * - Market cap (price × supply)
 * - Reserve balance (from bonding curve)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getExplorerAddressUrl } from "@/lib/contracts";
import { createPublicClient, http, formatEther, type Address } from "viem";
import { monadTestnet } from "viem/chains";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// nad.fun contract addresses (testnet)
const NAD_LENS: Address = "0xB056d79CA5257589692699a46623F901a3BB76f1";

// Minimal ABIs for on-chain reads
const BURN_ADDRESS: Address = "0x000000000000000000000000000000000000dEaD";

const erc20ReadAbi = [
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "name", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

const lensAbi = [
  {
    type: "function",
    name: "getAmountOut",
    inputs: [
      { name: "_token", type: "address" },
      { name: "_amountIn", type: "uint256" },
      { name: "_isBuy", type: "bool" },
    ],
    outputs: [
      { name: "router", type: "address" },
      { name: "amountOut", type: "uint256" },
    ],
    stateMutability: "view",
  },
] as const;

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id: agentId } = await params;

  try {
    // Fetch agent to get token address
    const { data: agent, error: fetchError } = await supabase
      .from("agents")
      .select("id, name, token_address, token_symbol, status, nadfun_pool_address, investor_share_bps")
      .eq("id", agentId)
      .single();

    if (fetchError || !agent) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    if (!agent.token_address) {
      return NextResponse.json(
        { success: false, error: "Agent has no token deployed yet" },
        { status: 400 }
      );
    }

    const tokenAddress = agent.token_address as Address;

    const publicClient = createPublicClient({
      chain: monadTestnet,
      transport: http(),
    });

    // Fetch ERC20 basics + price quote in parallel
    const smallMon = BigInt("1000000000000000"); // 0.001 MON for price quote

    const [symbol, name, totalSupplyRaw, burnedRaw, lensResult] = await Promise.all([
      publicClient.readContract({
        address: tokenAddress,
        abi: erc20ReadAbi,
        functionName: "symbol",
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: erc20ReadAbi,
        functionName: "name",
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: erc20ReadAbi,
        functionName: "totalSupply",
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: erc20ReadAbi,
        functionName: "balanceOf",
        args: [BURN_ADDRESS],
      }).catch(() => 0n),
      publicClient.readContract({
        address: NAD_LENS,
        abi: lensAbi,
        functionName: "getAmountOut",
        args: [tokenAddress, smallMon, true],
      }).catch(() => null),
    ]);

    // Derive price from buy-side quote: price = MON spent / tokens received
    let currentPrice = "0";
    let marketCap = "0";
    const totalSupply = formatEther(totalSupplyRaw);
    const burned = formatEther(burnedRaw as bigint);
    const circulatingSupply = (parseFloat(totalSupply) - parseFloat(burned)).toString();

    if (lensResult) {
      const [, tokensOut] = lensResult;
      if (tokensOut > 0n) {
        const priceNum = parseFloat(formatEther(smallMon)) / parseFloat(formatEther(tokensOut));
        currentPrice = priceNum.toFixed(8);
        marketCap = (priceNum * parseFloat(circulatingSupply)).toFixed(4);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        symbol,
        name,
        address: agent.token_address,
        totalSupply,
        burned,
        circulatingSupply,
        currentPrice,
        marketCap,
        reserveBalance: "0", // nad.fun doesn't expose reserve directly
        investorShareBps: agent.investor_share_bps || 0,
        agentId: agent.id,
        agentName: agent.name,
        explorerUrl: getExplorerAddressUrl(tokenAddress),
        bondingCurve: {
          type: "nad.fun",
          description: "nad.fun bonding curve. Price adjusts with supply.",
          formula: "Automated market maker",
          basePrice: "Variable",
          priceIncrement: "Dynamic",
        },
      },
    });
  } catch (err) {
    console.error("[Token API] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to fetch token details" },
      { status: 500 }
    );
  }
}
