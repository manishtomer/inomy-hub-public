/**
 * Agent Creation Confirmation API
 *
 * POST /api/agents/[id]/confirm
 * Called twice during agent creation:
 *
 * 1st call: After user signs nad.fun BondingCurveRouter.create() TX
 *   - Parses CurveCreate event from receipt
 *   - Stores token_address + nadfun_pool_address
 *   - Returns { step: "token_created" }
 *
 * 2nd call: After user signs USDC seed transfer
 *   - Marks agent as ACTIVE
 *   - Returns { step: "funded" }
 *
 * Body: { txHash: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getPublicClient,
  getExplorerTxUrl,
  getWalletClientFromPrivateKey,
  getAgentTypeEnum,
  registerAgentOnChain,
} from "@/lib/contracts";
import { parseTokenCreationReceipt, getNadFunTokenUrl } from "@/lib/nadfun";
import { PERSONALITY_DEFAULTS } from "@/lib/agent-runtime/constants";
import type { Hash, Address } from "viem";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface ConfirmRequest {
  txHash: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params;
    const body = (await request.json()) as ConfirmRequest;

    if (!body.txHash) {
      return NextResponse.json(
        { success: false, error: "txHash is required" },
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

    // Check if already active
    if (agent.status === "ACTIVE") {
      return NextResponse.json({
        success: true,
        message: "Agent is already active",
        step: "funded",
        data: agent,
      });
    }

    const publicClient = getPublicClient();
    const txHash = body.txHash as Hash;

    // Wait for TX confirmation
    console.log(`[Agent Confirm] Waiting for TX: ${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 60_000,
    });

    if (receipt.status !== "success") {
      return NextResponse.json(
        { success: false, error: "Transaction failed on chain" },
        { status: 400 }
      );
    }

    console.log(`[Agent Confirm] TX confirmed in block ${receipt.blockNumber}`);

    // Determine which step this is based on whether agent already has a token_address
    if (!agent.token_address) {
      // --- Step 1: Token creation TX → parse CurveCreate event ---
      console.log("[Agent Confirm] Parsing nad.fun token creation receipt...");

      const tokenData = parseTokenCreationReceipt(receipt);
      if (!tokenData) {
        return NextResponse.json(
          {
            success: false,
            error: "Could not find CurveCreate event in transaction receipt. Is this the correct nad.fun create TX?",
          },
          { status: 400 }
        );
      }

      const tokenUrl = getNadFunTokenUrl(tokenData.tokenAddress);

      // Update agent with token data
      const { error: updateError } = await supabase
        .from("agents")
        .update({
          token_address: tokenData.tokenAddress,
          nadfun_pool_address: tokenData.poolAddress,
          nadfun_tx_hash: txHash,
        })
        .eq("id", agentId);

      if (updateError) {
        console.error("[Agent Confirm] DB update failed:", updateError);
        return NextResponse.json(
          { success: false, error: "Failed to update database" },
          { status: 500 }
        );
      }

      console.log(`[Agent Confirm] Token stored: ${tokenData.tokenAddress}`);

      return NextResponse.json({
        success: true,
        step: "token_created",
        data: {
          token_address: tokenData.tokenAddress,
          pool_address: tokenData.poolAddress,
          token_url: tokenUrl,
          tx_hash: txHash,
          block_number: Number(receipt.blockNumber),
          explorer_url: getExplorerTxUrl(txHash),
        },
      });
    } else {
      // --- Step 2: USDC funding TX → mark ACTIVE ---
      console.log("[Agent Confirm] USDC funding confirmed, marking ACTIVE...");

      const { error: updateError } = await supabase
        .from("agents")
        .update({ status: "ACTIVE" })
        .eq("id", agentId);

      if (updateError) {
        console.error("[Agent Confirm] DB update failed:", updateError);
        return NextResponse.json(
          { success: false, error: "Failed to update database" },
          { status: 500 }
        );
      }

      // === On-chain registration via AgentRegistry ===
      const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
      if (deployerKey && agent.wallet_address) {
        try {
          console.log("[Agent Confirm] Registering agent on-chain...");
          const deployerWallet = getWalletClientFromPrivateKey(deployerKey);
          const agentTypeEnum = getAgentTypeEnum(agent.type || "CATALOG");

          const regResult = await registerAgentOnChain(deployerWallet, {
            name: agent.name,
            symbol: agent.token_symbol || agent.name.slice(0, 4).toUpperCase(),
            agentType: agentTypeEnum,
            walletAddress: agent.wallet_address as Address,
            metadataURI: "",
            investorShareBps: 7500n,
            creatorAllocation: 0n,
          });

          // Store chain_agent_id in DB
          await supabase
            .from("agents")
            .update({ chain_agent_id: Number(regResult.agentId) })
            .eq("id", agentId);

          console.log(`[Agent Confirm] On-chain registration complete: chainId=${regResult.agentId}, tx=${regResult.txHash}`);
        } catch (regErr) {
          // Non-fatal — agent is still ACTIVE, can be registered later
          console.error("[Agent Confirm] On-chain registration failed:", regErr);
        }
      }

      // Registration fee is paid directly by user to platform wallet during creation
      // (split transfer in create page: seed → agent, fee → platform wallet)

      // Create default policy based on agent personality so it can bid
      const personality = agent.personality || "balanced";
      const defaultPolicy = PERSONALITY_DEFAULTS[personality] || PERSONALITY_DEFAULTS["balanced"];
      const { error: policyError } = await supabase
        .from("agent_policies")
        .upsert(
          {
            agent_id: agentId,
            personality,
            policy_version: 0,
            policy_json: defaultPolicy,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "agent_id" }
        );

      if (policyError) {
        console.error("[Agent Confirm] Failed to create default policy:", policyError);
        // Non-fatal — agent is ACTIVE but won't bid until policy is created
      } else {
        console.log(`[Agent Confirm] Default ${personality} policy created for ${agent.name}`);
      }

      // Fetch updated agent
      const { data: updatedAgent } = await supabase
        .from("agents")
        .select("*")
        .eq("id", agentId)
        .single();

      // Trigger chain sync to pick up on-chain events from agent creation
      try {
        const origin = request.nextUrl.origin;
        fetch(`${origin}/api/sync/trigger`, { method: "POST" }).catch(() => {});
        console.log("[Agent Confirm] Chain sync triggered");
      } catch { /* best-effort */ }

      return NextResponse.json({
        success: true,
        step: "funded",
        data: updatedAgent,
        funding: {
          tx_hash: txHash,
          block_number: Number(receipt.blockNumber),
          explorer_url: getExplorerTxUrl(txHash),
        },
      });
    }
  } catch (err) {
    console.error("Error confirming agent:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
