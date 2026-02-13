/**
 * Investment Hook - React hook for buying/selling agent tokens
 *
 * This hook handles the full investment flow:
 * 1. Get quote from API
 * 2. Sign transaction with user's wallet
 * 3. Wait for confirmation
 * 4. Update UI
 */

"use client";

import { useState, useCallback } from "react";
import { useWallets } from "@privy-io/react-auth";
import { parseEther, formatEther } from "viem";

export interface InvestmentQuote {
  tokenAmount: string;
  tokenAmountFormatted: string;
  cost: string;
  costFormatted: string;
  fee: string;
  feeFormatted: string;
  totalCost: string;
  totalCostFormatted: string;
  currentPrice: string;
  currentPriceFormatted: string;
}

export interface InvestmentResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

export interface UseInvestReturn {
  // State
  loading: boolean;
  error: string | null;
  quote: InvestmentQuote | null;

  // Actions
  getQuote: (agentId: string, tokenAmount: string) => Promise<InvestmentQuote | null>;
  buyTokens: (agentId: string, tokenAmount: string) => Promise<InvestmentResult>;
  sellTokens: (agentId: string, tokenAmount: string) => Promise<InvestmentResult>;
  clearError: () => void;
}

/**
 * Hook for investing in agents
 */
export function useInvest(): UseInvestReturn {
  const { wallets } = useWallets();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<InvestmentQuote | null>(null);

  const getConnectedWallet = useCallback(() => {
    const wallet = wallets.find((w) => w.walletClientType === "privy");
    if (!wallet) {
      throw new Error("No wallet connected. Please connect your wallet first.");
    }
    return wallet;
  }, [wallets]);

  /**
   * Get a quote for buying tokens
   */
  const getQuote = useCallback(
    async (agentId: string, tokenAmount: string): Promise<InvestmentQuote | null> => {
      try {
        setLoading(true);
        setError(null);

        const wallet = getConnectedWallet();

        // Convert human-readable amount to wei (18 decimals)
        const tokenAmountWei = parseEther(tokenAmount).toString();

        const response = await fetch("/api/invest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId,
            tokenAmount: tokenAmountWei,
            investorWallet: wallet.address,
            action: "quote",
          }),
        });

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to get quote");
        }

        setQuote(data.quote);
        return data.quote;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to get quote";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [getConnectedWallet]
  );

  /**
   * Buy agent tokens
   */
  const buyTokens = useCallback(
    async (agentId: string, tokenAmount: string): Promise<InvestmentResult> => {
      try {
        setLoading(true);
        setError(null);

        const wallet = getConnectedWallet();
        const provider = await wallet.getEthereumProvider();

        // Convert human-readable amount to wei
        const tokenAmountWei = parseEther(tokenAmount).toString();

        // Get transaction data from API
        const response = await fetch("/api/invest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId,
            tokenAmount: tokenAmountWei,
            investorWallet: wallet.address,
            action: "buy",
          }),
        });

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to prepare transaction");
        }

        // Send transaction via user's wallet
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: wallet.address,
              to: data.transaction.to,
              data: data.transaction.data,
              value: "0x" + BigInt(data.transaction.value).toString(16),
              chainId: "0x" + data.transaction.chainId.toString(16),
            },
          ],
        });

        // Wait for confirmation (simple polling)
        let confirmed = false;
        for (let i = 0; i < 30; i++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          try {
            const receipt = await provider.request({
              method: "eth_getTransactionReceipt",
              params: [txHash],
            });
            if (receipt) {
              confirmed = true;
              break;
            }
          } catch {
            // Continue polling
          }
        }

        if (!confirmed) {
          console.warn("Transaction sent but confirmation timeout. Hash:", txHash);
        }

        return { success: true, txHash: txHash as string };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Transaction failed";
        setError(message);
        return { success: false, error: message };
      } finally {
        setLoading(false);
      }
    },
    [getConnectedWallet]
  );

  /**
   * Sell agent tokens
   */
  const sellTokens = useCallback(
    async (agentId: string, tokenAmount: string): Promise<InvestmentResult> => {
      try {
        setLoading(true);
        setError(null);

        const wallet = getConnectedWallet();
        const provider = await wallet.getEthereumProvider();

        // Convert human-readable amount to wei
        const tokenAmountWei = parseEther(tokenAmount).toString();

        // Get transaction data from API
        const response = await fetch("/api/invest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId,
            tokenAmount: tokenAmountWei,
            investorWallet: wallet.address,
            action: "sell",
          }),
        });

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to prepare transaction");
        }

        // Send transaction via user's wallet
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: wallet.address,
              to: data.transaction.to,
              data: data.transaction.data,
              value: "0x0",
              chainId: "0x" + data.transaction.chainId.toString(16),
            },
          ],
        });

        return { success: true, txHash: txHash as string };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Transaction failed";
        setError(message);
        return { success: false, error: message };
      } finally {
        setLoading(false);
      }
    },
    [getConnectedWallet]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    loading,
    error,
    quote,
    getQuote,
    buyTokens,
    sellTokens,
    clearError,
  };
}

/**
 * Format MON amount for display
 */
export function formatMON(weiAmount: string | bigint, decimals = 6): string {
  const formatted = formatEther(BigInt(weiAmount));
  const num = parseFloat(formatted);
  if (num < 0.000001) return "< 0.000001";
  return num.toFixed(decimals);
}
