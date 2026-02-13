/**
 * Thirdweb Client Configuration
 *
 * Configures the Thirdweb SDK for x402 payments on Monad testnet.
 * Provides facilitator, USDC balance reading, and cost sink configuration.
 */

import { createThirdwebClient } from "thirdweb";
import { monadTestnet } from "thirdweb/chains";
import { facilitator } from "thirdweb/x402";

// Re-export the chain for convenience
export { monadTestnet };

// USDC contract address on Monad Testnet
export const USDC_ADDRESS =
  process.env.NEXT_PUBLIC_USDC_ADDRESS ||
  "0x534b2f3A21130d7a60830c2Df862319e593943A3";

// USDC has 6 decimals
export const USDC_DECIMALS = 6;

// Cost sink wallet = deployer wallet (recycles USDC back into the system)
export const COST_SINK_WALLET =
  process.env.COST_SINK_WALLET_ADDRESS ||
  "0x94AE63aD0A6aB42e1688CCe578D0DD8b4A2B24e2";

// Monad testnet RPC
const MONAD_RPC =
  process.env.NEXT_PUBLIC_RPC_URL || "https://testnet-rpc.monad.xyz";

// ERC-20 balanceOf(address) function selector
const BALANCE_OF_SELECTOR = "0x70a08231";

/**
 * Create Thirdweb client for client-side usage
 * Uses the public client ID (safe to expose)
 */
export function createClientSideThirdwebClient() {
  const clientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID;
  if (!clientId) {
    throw new Error("NEXT_PUBLIC_THIRDWEB_CLIENT_ID is not set");
  }
  return createThirdwebClient({ clientId });
}

/**
 * Create Thirdweb client for server-side usage
 * Uses the secret key (never expose to client)
 */
export function createServerSideThirdwebClient() {
  const secretKey = process.env.THIRDWEB_SECRET_KEY;
  if (!secretKey) {
    throw new Error("THIRDWEB_SECRET_KEY is not set");
  }
  return createThirdwebClient({ secretKey });
}

/**
 * Create a Thirdweb x402 facilitator for payment settlement
 *
 * The facilitator verifies and settles payments on-chain.
 * serverWalletAddress = the wallet RECEIVING the payment (the agent's wallet).
 * This must be created per-request since each agent has a different wallet.
 *
 * @param recipientWallet The agent wallet address that should receive the USDC payment
 */
export function createX402Facilitator(recipientWallet: string) {
  const client = createServerSideThirdwebClient();
  return facilitator({
    client,
    serverWalletAddress: recipientWallet,
    waitUntil: "confirmed",
  });
}

/**
 * Get USDC balance for a wallet address (ERC-20 balanceOf)
 *
 * @param walletAddress The wallet to check
 * @returns Balance in USDC (human-readable, e.g., 1.5 = $1.50)
 */
export async function getUsdcBalance(walletAddress: string): Promise<number> {
  const paddedAddress = walletAddress.slice(2).padStart(64, "0");
  const data = `${BALANCE_OF_SELECTOR}${paddedAddress}`;

  const response = await fetch(MONAD_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: USDC_ADDRESS, data }, "latest"],
      id: 1,
    }),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(`Failed to fetch USDC balance: ${result.error.message}`);
  }

  const rawBalance = BigInt(result.result);
  return fromUsdcUnits(rawBalance);
}

/**
 * Convert USDC amount to raw units (6 decimals)
 */
export function toUsdcUnits(amount: number): bigint {
  return BigInt(Math.floor(amount * 10 ** USDC_DECIMALS));
}

/**
 * Convert raw USDC units to human-readable amount
 */
export function fromUsdcUnits(rawAmount: bigint): number {
  return Number(rawAmount) / 10 ** USDC_DECIMALS;
}

/**
 * Format USDC amount for display
 */
export function formatUsdc(amount: number): string {
  return `$${amount.toFixed(6)}`;
}
