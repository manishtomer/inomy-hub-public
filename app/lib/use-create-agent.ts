/**
 * Create Agent Hook - React hook for creating agents with nad.fun token
 *
 * Flow (user signs 2 TXs):
 * 1. POST /api/agents — creates DB record, Privy wallet, prepares nad.fun TX
 * 2. User signs BondingCurveRouter.create() TX (deploys token on nad.fun)
 * 3. POST /api/agents/[id]/confirm — parses CurveCreate event, stores token data
 * 4. User signs USDC seed transfer
 * 5. POST /api/agents/[id]/confirm — marks agent ACTIVE
 */

"use client";

import { useState, useCallback } from "react";
import { useWallets } from "@privy-io/react-auth";
import { parseUnits, encodeFunctionData } from "viem";

// USDC contract on Monad Testnet
const USDC_ADDRESS = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const USDC_DECIMALS = 6;
const CHAIN_ID = 10143;

const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface CreateAgentParams {
  name: string;
  type: "CATALOG" | "REVIEW" | "CURATION" | "SELLER";
  symbol: string;
  personality?: string;
  description?: string;
  initialBuyAmount?: string; // MON for initial token buy
  seedAmount: string; // USDC seed
}

export interface AgentCreationResult {
  success: boolean;
  agentId?: string;
  tokenAddress?: string;
  nadfunTokenUrl?: string;
  error?: string;
}

export interface UseCreateAgentReturn {
  loading: boolean;
  error: string | null;
  step: "idle" | "creating" | "signing" | "confirming" | "funding" | "complete";
  createAgent: (params: CreateAgentParams) => Promise<AgentCreationResult>;
  clearError: () => void;
}

export function useCreateAgent(): UseCreateAgentReturn {
  const { wallets } = useWallets();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "creating" | "signing" | "confirming" | "funding" | "complete">("idle");

  const getConnectedWallet = useCallback(() => {
    const wallet = wallets[0];
    if (!wallet) {
      throw new Error("No wallet connected. Please connect your wallet first.");
    }
    return wallet;
  }, [wallets]);

  const createAgent = useCallback(
    async (params: CreateAgentParams): Promise<AgentCreationResult> => {
      try {
        setLoading(true);
        setError(null);
        setStep("creating");

        const wallet = getConnectedWallet();
        const provider = await wallet.getEthereumProvider();

        // Step 1: Create agent + prepare nad.fun TX (server-side)
        console.log("[CreateAgent] Step 1: Creating agent + preparing nad.fun TX...");
        const createResponse = await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: params.name,
            type: params.type,
            symbol: params.symbol.toUpperCase(),
            personality: params.personality || "balanced",
            description: params.description,
            ownerWallet: wallet.address,
            initialBuyAmount: params.initialBuyAmount || "0.1",
          }),
        });

        const createData = await createResponse.json();

        if (!createData.success) {
          throw new Error(createData.error || "Failed to create agent");
        }

        const agentId = createData.data.id;
        const agentWallet = createData.data.wallet_address;
        const transaction = createData.transaction;

        console.log(`[CreateAgent] Agent created: ${agentId}`);

        if (!transaction) {
          throw new Error("Server did not return nad.fun transaction data");
        }

        // Step 2: User signs nad.fun BondingCurveRouter.create() TX
        setStep("signing");
        console.log("[CreateAgent] Step 2: Signing nad.fun token creation TX...");

        const createTxHash = await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: wallet.address,
              to: transaction.to,
              data: transaction.data,
              value: "0x" + BigInt(transaction.value).toString(16),
              chainId: "0x" + CHAIN_ID.toString(16),
            },
          ],
        });

        console.log(`[CreateAgent] nad.fun create TX: ${createTxHash}`);

        // Step 3: Confirm token creation (parse CurveCreate event)
        setStep("confirming");
        console.log("[CreateAgent] Step 3: Confirming token creation...");

        const tokenConfirmResponse = await fetch(`/api/agents/${agentId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash: createTxHash }),
        });

        const tokenConfirmData = await tokenConfirmResponse.json();
        if (!tokenConfirmData.success) {
          throw new Error(tokenConfirmData.error || "Failed to confirm token creation");
        }

        const tokenAddress = tokenConfirmData.data?.token_address;
        const nadfunTokenUrl = tokenConfirmData.data?.token_url;

        console.log(`[CreateAgent] Token confirmed: ${tokenAddress}`);

        // Step 4: User signs USDC seed transfer
        setStep("funding");
        console.log("[CreateAgent] Step 4: Signing USDC seed transfer...");

        const seedAmountRaw = parseUnits(params.seedAmount, USDC_DECIMALS);
        const transferData = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [agentWallet as `0x${string}`, seedAmountRaw],
        });

        const seedTxHash = await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: wallet.address,
              to: USDC_ADDRESS,
              data: transferData,
              chainId: "0x" + CHAIN_ID.toString(16),
            },
          ],
        });

        console.log(`[CreateAgent] USDC seed TX: ${seedTxHash}`);

        // Step 5: Confirm funding
        console.log("[CreateAgent] Step 5: Confirming USDC transfer...");
        const confirmResponse = await fetch(`/api/agents/${agentId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash: seedTxHash }),
        });

        const confirmData = await confirmResponse.json();
        if (!confirmData.success) {
          throw new Error(confirmData.error || "Failed to confirm funding");
        }

        setStep("complete");
        console.log("[CreateAgent] Agent creation complete!");

        return {
          success: true,
          agentId,
          tokenAddress,
          nadfunTokenUrl,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create agent";
        setError(message);
        setStep("idle");
        return { success: false, error: message };
      } finally {
        setLoading(false);
      }
    },
    [getConnectedWallet]
  );

  const clearError = useCallback(() => {
    setError(null);
    setStep("idle");
  }, []);

  return {
    loading,
    error,
    step,
    createAgent,
    clearError,
  };
}
