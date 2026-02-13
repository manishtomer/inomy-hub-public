/**
 * Privy Server-Side Integration
 * Handles embedded wallet creation and management for agents
 * Using @privy-io/node for server-side wallet operations
 *
 * Supports both MON (native) and USDC (ERC-20) balance checking,
 * and USDC transfers for x402 cost sink payments.
 */

import { PrivyClient } from "@privy-io/node";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "./contracts";
import type {
  AgentWalletInfo,
  TransactionResult,
} from "@/types/database";
import {
  USDC_ADDRESS,
  COST_SINK_WALLET,
  toUsdcUnits,
  fromUsdcUnits,
} from "./thirdweb-client";

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID!;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET!;

const MONAD_TESTNET_CHAIN_ID = 10143;
const MONAD_TESTNET_RPC =
  process.env.NEXT_PUBLIC_RPC_URL || "https://testnet-rpc.monad.xyz";

// Escrow wallet = deployer wallet (holds protected investor funds)
export const ESCROW_WALLET =
  process.env.ESCROW_WALLET_ADDRESS ||
  process.env.DEPLOYER_WALLET ||
  "0x94AE63aD0A6aB42e1688CCe578D0DD8b4A2B24e2";

// Escrow wallet's private key (for signing dividend payouts)
// Uses the deployer private key since escrow wallet = deployer wallet
const ESCROW_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

// ERC-20 function selectors
const BALANCE_OF_SELECTOR = "0x70a08231"; // balanceOf(address)
const TRANSFER_SELECTOR = "0xa9059cbb"; // transfer(address,uint256)

if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
  throw new Error("Privy environment variables not configured");
}

// ============================================================================
// PRIVY CLIENT SINGLETON
// ============================================================================

let privyClientInstance: PrivyClient | null = null;

export function getPrivyClient(): PrivyClient {
  if (!privyClientInstance) {
    privyClientInstance = new PrivyClient({
      appId: PRIVY_APP_ID,
      appSecret: PRIVY_APP_SECRET,
    });
  }
  return privyClientInstance;
}

// ============================================================================
// WALLET CREATION
// ============================================================================

/**
 * Create a SERVER WALLET for an agent
 *
 * Server wallets (created via client.wallets.create()) can be signed by the
 * server without user interaction. This is required for agents to autonomously
 * pay operational costs.
 *
 * Previously we used client.users().create() which creates USER-OWNED embedded
 * wallets that require user authentication to sign - causing the error:
 * "No valid authorization keys or user signing keys available"
 */
export async function createAgentWithWallet(
  agentId: string,
  agentName: string
): Promise<AgentWalletInfo> {
  const client = getPrivyClient();

  try {
    // Create a SERVER WALLET (not user-owned) so the server can sign transactions
    // Note: create() is inherited from Wallets base class, cast needed for TypeScript
    const walletsService = client.wallets() as unknown as {
      create(params: { chain_type: string }): Promise<{ id: string; address: string }>;
    };
    const wallet = await walletsService.create({
      chain_type: "ethereum",
    });

    const walletInfo: AgentWalletInfo = {
      wallet_address: wallet.address,
      privy_wallet_id: wallet.id,
      privy_user_id: `server_wallet_${agentId}`, // No user, just track the agent
      chain_id: MONAD_TESTNET_CHAIN_ID,
    };

    console.log(`Created SERVER wallet for agent ${agentName}:`, {
      agentId,
      walletId: wallet.id,
      walletAddress: walletInfo.wallet_address,
    });

    return walletInfo;
  } catch (error) {
    console.error("Error creating agent wallet:", error);
    throw new Error(
      `Failed to create wallet for agent ${agentName}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

// ============================================================================
// TRANSACTION SENDING
// ============================================================================

/**
 * Send a transaction from an agent's SERVER wallet
 *
 * Server wallets (created via client.wallets().create() without an owner)
 * can be signed by the server using just app credentials - no user JWT needed.
 *
 * Note: Wallets created via client.users().create() are user-owned and require
 * user JWT authorization, causing "No valid authorization keys" error.
 */
export async function sendAgentTransaction(
  privyWalletId: string,
  to: string,
  value: string,
  data?: string
): Promise<TransactionResult> {
  const client = getPrivyClient();

  // Ensure value is in hex format
  const hexValue = value.startsWith("0x") ? value : `0x${BigInt(value || "0").toString(16)}`;

  console.log("[Privy TX] Sending transaction:", {
    privyWalletId,
    to,
    value: hexValue,
    data: data ? `${data.slice(0, 10)}...` : "0x",
    chainId: MONAD_TESTNET_CHAIN_ID,
  });

  try {
    // Use ethereum().sendTransaction() - works for server wallets (no owner)
    // Server wallets don't need authorization_context
    const response = await client
      .wallets()
      .ethereum()
      .sendTransaction(privyWalletId, {
        caip2: `eip155:${MONAD_TESTNET_CHAIN_ID}`,
        params: {
          transaction: {
            to,
            data: data || "0x",
            value: hexValue,
            chain_id: MONAD_TESTNET_CHAIN_ID,
          },
        },
      });

    console.log("[Privy TX] Transaction broadcast:", {
      hash: response.hash,
      caip2: response.caip2,
    });

    return {
      transaction_hash: response.hash,
      status: "pending",
      from: response.transaction_request?.from || "",
      to,
      value,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Privy TX] Error sending transaction:", error);

    // Provide helpful guidance for authorization errors
    if (errorMsg.includes("No valid authorization keys")) {
      console.error(
        "[Privy TX] This wallet was likely created as a USER-OWNED wallet (via users().create()). " +
        "User-owned wallets require user JWT authorization. " +
        "To fix: Create a new agent - it will get a SERVER wallet that can sign autonomously."
      );
    }

    throw new Error(`Failed to send transaction: ${errorMsg}`);
  }
}

/**
 * Send USDC (ERC-20) from an agent's wallet to a recipient
 *
 * Used for:
 * - Paying operational costs to the cost sink (deployer wallet)
 * - Agent-to-agent service payments
 *
 * @param privyWalletId The Privy wallet ID for signing
 * @param to Recipient wallet address
 * @param amountUsdc Amount in USDC (e.g., 0.057 for $0.057)
 */
export async function sendUsdcFromAgent(
  privyWalletId: string,
  to: string,
  amountUsdc: number
): Promise<TransactionResult> {
  const rawAmount = toUsdcUnits(amountUsdc);

  // Encode ERC-20 transfer(address,uint256) calldata
  const paddedTo = to.slice(2).padStart(64, "0");
  const paddedAmount = rawAmount.toString(16).padStart(64, "0");
  const calldata = `${TRANSFER_SELECTOR}${paddedTo}${paddedAmount}`;

  console.log(`[USDC Transfer] ${amountUsdc} USDC to ${to}`, {
    privyWalletId,
    usdcContract: USDC_ADDRESS,
    rawAmount: rawAmount.toString(),
  });

  // Send as a contract call (value=0x0, data=ERC20 transfer calldata)
  return sendAgentTransaction(privyWalletId, USDC_ADDRESS, "0x0", calldata);
}

/**
 * Pay operational cost to the cost sink wallet
 *
 * Convenience function for agents paying their operational costs
 * after completing a task.
 *
 * @param privyWalletId Agent's Privy wallet ID
 * @param costUsdc Operational cost in USDC
 */
export async function payOperationalCostToSink(
  privyWalletId: string,
  costUsdc: number
): Promise<TransactionResult> {
  console.log(
    `[Cost Sink] Agent paying $${costUsdc} USDC operational cost to ${COST_SINK_WALLET}`
  );
  return sendUsdcFromAgent(privyWalletId, COST_SINK_WALLET, costUsdc);
}

// ============================================================================
// WALLET BALANCE
// ============================================================================

/**
 * Get native MON balance of an agent's wallet
 */
export async function getAgentWalletBalance(
  walletAddress: string
): Promise<string> {
  try {
    const response = await fetch(MONAD_TESTNET_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getBalance",
        params: [walletAddress, "latest"],
        id: 1,
      }),
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || "Failed to fetch balance");
    }

    const balanceWei = BigInt(data.result);
    const balanceEth = Number(balanceWei) / 1e18;
    return balanceEth.toFixed(6);
  } catch (error) {
    console.error("Error fetching wallet balance:", error);
    throw new Error(
      `Failed to fetch MON balance for ${walletAddress}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Get USDC (ERC-20) balance of an agent's wallet
 *
 * This is the agent's actual operational balance - all task payments
 * and costs are in USDC.
 *
 * @returns Balance in USDC (human-readable, e.g., 1.5 = $1.50)
 */
export async function getAgentUsdcBalance(
  walletAddress: string
): Promise<number> {
  try {
    const paddedAddress = walletAddress.slice(2).padStart(64, "0");
    const calldata = `${BALANCE_OF_SELECTOR}${paddedAddress}`;

    const response = await fetch(MONAD_TESTNET_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{ to: USDC_ADDRESS, data: calldata }, "latest"],
        id: 1,
      }),
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || "Failed to fetch USDC balance");
    }

    const rawBalance = BigInt(data.result);
    return fromUsdcUnits(rawBalance);
  } catch (error) {
    console.error("Error fetching USDC balance:", error);
    throw new Error(
      `Failed to fetch USDC balance for ${walletAddress}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Get both MON and USDC balances for an agent
 */
export async function getAgentBalances(
  walletAddress: string
): Promise<{ mon: string; usdc: number }> {
  const [mon, usdc] = await Promise.all([
    getAgentWalletBalance(walletAddress),
    getAgentUsdcBalance(walletAddress),
  ]);
  return { mon, usdc };
}

// ============================================================================
// WALLET INFO RETRIEVAL
// ============================================================================

export async function getAgentWalletInfo(
  privyUserId: string
): Promise<AgentWalletInfo> {
  const client = getPrivyClient();

  try {
    const user = await client.users()._get(privyUserId);

    const embeddedWallet = user.linked_accounts.find(
      (account) => account.type === "wallet"
    );

    if (!embeddedWallet || embeddedWallet.type !== "wallet") {
      throw new Error("No embedded wallet found for user");
    }

    const [monBalance, usdcBalance] = await Promise.all([
      getAgentWalletBalance(embeddedWallet.address),
      getAgentUsdcBalance(embeddedWallet.address),
    ]);

    const walletId =
      embeddedWallet.type === "wallet" && "id" in embeddedWallet
        ? embeddedWallet.id
        : null;

    return {
      wallet_address: embeddedWallet.address,
      privy_wallet_id: walletId || embeddedWallet.address,
      privy_user_id: user.id,
      balance: monBalance,
      usdc_balance: usdcBalance,
      chain_id: MONAD_TESTNET_CHAIN_ID,
    };
  } catch (error) {
    console.error("Error fetching wallet info:", error);
    throw new Error(
      `Failed to fetch wallet info: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

// ============================================================================
// ESCROW FUNCTIONS (Protected Investor Dividends)
// ============================================================================

/**
 * Transfer investor share to escrow wallet
 *
 * Called after task completion, sends the investor's share of profit
 * to the escrow wallet where it's protected until claimed.
 *
 * @param fromPrivyWalletId Agent's Privy wallet ID
 * @param amount Amount in USDC to escrow
 * @param agentId Agent's database ID (for logging)
 * @returns Transaction result with hash if successful
 */
export async function depositToEscrow(
  fromPrivyWalletId: string,
  amount: number,
  agentId: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (amount <= 0) {
    return { success: true, txHash: undefined }; // Nothing to transfer
  }

  console.log(`[Escrow Deposit] Transferring $${amount} USDC to escrow for agent ${agentId}`);

  try {
    const result = await sendUsdcFromAgent(fromPrivyWalletId, ESCROW_WALLET, amount);

    console.log(`[Escrow Deposit] Success: ${result.transaction_hash}`);

    return {
      success: true,
      txHash: result.transaction_hash,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Escrow Deposit] Failed for agent ${agentId}:`, error);

    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Pay dividend from escrow to investor
 *
 * Called when an investor claims their accumulated escrow balance.
 * Transfers USDC from the escrow wallet (deployer) to the investor's wallet.
 * Uses the deployer's private key to sign the transaction directly.
 *
 * @param toWallet Investor's wallet address
 * @param amount Amount in USDC to pay
 * @param agentId Agent's database ID (for logging)
 * @returns Transaction result with hash if successful
 */
export async function payDividendFromEscrow(
  toWallet: string,
  amount: number,
  agentId: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (amount <= 0) {
    return { success: false, error: "Amount must be greater than 0" };
  }

  // Minimum claim amount to prevent dust attacks
  const MINIMUM_CLAIM = 0.000001;
  if (amount < MINIMUM_CLAIM) {
    return { success: false, error: `Minimum claim amount is ${MINIMUM_CLAIM} USDC` };
  }

  console.log(`[Dividend Payout] Paying $${amount} USDC to ${toWallet} for agent ${agentId}`);

  // Check if escrow private key is configured
  if (!ESCROW_PRIVATE_KEY) {
    console.error("[Dividend Payout] DEPLOYER_PRIVATE_KEY not configured");
    return {
      success: false,
      error: "Escrow wallet not configured. Contact admin.",
    };
  }

  try {
    // Create account from private key
    const account = privateKeyToAccount(`0x${ESCROW_PRIVATE_KEY.replace(/^0x/, "")}` as Hex);

    // Create clients
    const publicClient = createPublicClient({
      chain: monadTestnet,
      transport: http(MONAD_TESTNET_RPC),
    });

    const walletClient = createWalletClient({
      account,
      chain: monadTestnet,
      transport: http(MONAD_TESTNET_RPC),
    });

    // Encode USDC transfer
    const amountInUnits = toUsdcUnits(amount);
    const data = encodeFunctionData({
      abi: [
        {
          name: "transfer",
          type: "function",
          inputs: [
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ type: "bool" }],
        },
      ],
      functionName: "transfer",
      args: [toWallet as Address, amountInUnits],
    });

    // Send transaction
    const hash = await walletClient.sendTransaction({
      to: USDC_ADDRESS as Address,
      data,
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== "success") {
      return { success: false, error: "Transaction reverted" };
    }

    console.log(`[Dividend Payout] Success: ${hash}`);

    return {
      success: true,
      txHash: hash,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Dividend Payout] Failed for ${toWallet}:`, error);

    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Get USDC balance of the escrow wallet
 *
 * Useful for monitoring and verification.
 */
export async function getEscrowBalance(): Promise<number> {
  return getAgentUsdcBalance(ESCROW_WALLET);
}
