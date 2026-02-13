/**
 * x402 Payment Protocol Integration
 *
 * Operator pays winning agent for completed task via x402.
 * Agent pays operational cost to cost sink as plain USDC transfer (NOT x402).
 *
 * Flow:
 * 1. Operator creates task auction, agents bid
 * 2. Winner selected (score = reputation / bid)
 * 3. Operator pays winner the bid amount via x402 (POST /api/task-delivery/[taskId])
 * 4. Agent pays operational cost to cost sink (plain USDC via privy-server)
 *
 * @see https://x402.org
 * @see https://portal.thirdweb.com/x402
 */

import { settlePayment, verifyPayment as thirdwebVerifyPayment } from "thirdweb/x402";
import {
  monadTestnet,
  USDC_ADDRESS,
  USDC_DECIMALS,
  COST_SINK_WALLET,
  toUsdcUnits,
  fromUsdcUnits,
  createX402Facilitator,
} from "./thirdweb-client";

// Re-export for convenience
export { toUsdcUnits, fromUsdcUnits, USDC_ADDRESS, USDC_DECIMALS, COST_SINK_WALLET };

/**
 * Operational cost per task type (in USDC)
 * Agent pays this to the cost sink wallet after completing a task
 */
export const TASK_OPERATIONAL_COSTS = {
  CATALOG: 0.057,
  REVIEW: 0.072,
  CURATION: 0.067,
  SELLER: 0.05,
} as const;

export type TaskType = keyof typeof TASK_OPERATIONAL_COSTS;

/**
 * Handle x402 payment settlement for a task delivery endpoint.
 *
 * This is the main server-side function. It:
 * - Returns 402 with payment requirements if no payment provided
 * - Verifies and settles the payment on-chain if payment provided
 * - Returns status 200 when payment is successful
 *
 * @param request The incoming HTTP request
 * @param recipientWallet The agent wallet that should receive payment
 * @param priceUsdc Price in USDC (e.g., 0.067 for a winning bid)
 * @param description Human-readable description of the payment
 */
export async function handleX402Payment(
  request: Request,
  recipientWallet: string,
  priceUsdc: number,
  description: string
): Promise<{ status: number; paid: boolean; settled: boolean; settlementTxHash?: string; headers?: Record<string, string>; body?: unknown }> {
  const paymentData =
    request.headers.get("X-PAYMENT") ||
    request.headers.get("PAYMENT-SIGNATURE");

  try {
    const x402Facilitator = createX402Facilitator(recipientWallet);

    const result = await settlePayment({
      resourceUrl: request.url,
      method: request.method,
      paymentData,
      payTo: recipientWallet,
      network: monadTestnet,
      price: `$${priceUsdc}`,
      facilitator: x402Facilitator,
      waitUntil: "confirmed",
      routeConfig: {
        description,
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
      },
    });

    if (result.status === 200) {
      // settlePayment returns an internal UUID in `transaction`, not the on-chain hash.
      // We need to call GET /v1/transactions/{uuid} to get the real transactionHash.
      const internalId = result.paymentReceipt?.transaction;
      const settlementTxHash = internalId
        ? await resolveOnChainTxHash(internalId)
        : undefined;
      console.log(`[x402] Settlement confirmed (txHash: ${settlementTxHash || 'unknown'}, thirdwebId: ${internalId}, payer: ${result.paymentReceipt?.payer})`);
      return { status: 200, paid: true, settled: true, settlementTxHash, headers: result.responseHeaders };
    }

    // Facilitator rejected, but if a payment header IS present, try manual fallback
    // (facilitator may not be fully configured for settlement on this network)
    if (result.status === 402 && paymentData) {
      console.warn("[x402] Facilitator returned 402 with payment present, trying manual verification");
      return handleX402PaymentFallback(request, recipientWallet, priceUsdc, description);
    }

    return {
      status: result.status,
      paid: false,
      settled: false,
      headers: result.responseHeaders,
      body: result.responseBody,
    };
  } catch (error) {
    // If thirdweb facilitator is not configured, fall back to manual verification
    console.warn("[x402] Facilitator error, using manual verification:", error);
    return handleX402PaymentFallback(request, recipientWallet, priceUsdc, description);
  }
}

/**
 * Resolve the on-chain transaction hash from a thirdweb internal UUID.
 * The settlePayment API returns an internal tracking ID; the actual blockchain
 * hash is available via GET /v1/transactions/{id} with the secret key.
 */
async function resolveOnChainTxHash(thirdwebTxId: string): Promise<string | undefined> {
  try {
    const secretKey = process.env.THIRDWEB_SECRET_KEY;
    if (!secretKey) return undefined;

    const res = await fetch(`https://api.thirdweb.com/v1/transactions/${thirdwebTxId}`, {
      headers: { "x-secret-key": secretKey },
    });

    if (res.status !== 200) {
      console.warn(`[x402] Failed to resolve tx hash for ${thirdwebTxId}: ${res.status}`);
      return undefined;
    }

    const data = await res.json();
    const hash = data?.result?.transactionHash;
    if (hash && typeof hash === "string" && hash.startsWith("0x")) {
      return hash;
    }
    console.warn(`[x402] No transactionHash in response for ${thirdwebTxId}, status: ${data?.result?.status}`);
    return undefined;
  } catch (err) {
    console.warn(`[x402] Error resolving tx hash for ${thirdwebTxId}:`, err);
    return undefined;
  }
}

/**
 * Fallback payment handling when thirdweb facilitator is unavailable.
 * Uses manual payment verification (for development/testing).
 */
function handleX402PaymentFallback(
  request: Request,
  recipientWallet: string,
  priceUsdc: number,
  description: string
): { status: number; paid: boolean; settled: boolean; headers?: Record<string, string>; body?: unknown } {
  const paymentHeader =
    request.headers.get("X-PAYMENT") ||
    request.headers.get("PAYMENT-SIGNATURE");

  if (!paymentHeader) {
    // Return 402 with payment requirements
    const requirements = {
      scheme: "exact",
      network: "monad-testnet",
      maxAmountRequired: toUsdcUnits(priceUsdc).toString(),
      resource: description,
      description,
      mimeType: "application/json",
      payTo: recipientWallet,
      maxTimeoutSeconds: 300,
      asset: USDC_ADDRESS,
      extra: { name: "USDC", decimals: USDC_DECIMALS },
    };

    return {
      status: 402,
      paid: false,
      settled: false,
      headers: {
        "Content-Type": "application/json",
        "X-Payment-Requirements": JSON.stringify(requirements),
      },
      body: { error: "Payment Required", paymentRequirements: requirements },
    };
  }

  // Verify payment proof
  try {
    const payment = JSON.parse(paymentHeader);
    if (!payment.signature || !payment.payload) {
      return { status: 402, paid: false, settled: false, body: { error: "Invalid payment format" } };
    }

    if (payment.payload.payTo?.toLowerCase() !== recipientWallet.toLowerCase()) {
      return { status: 402, paid: false, settled: false, body: { error: "Payment recipient mismatch" } };
    }

    const paidAmount = BigInt(payment.payload.amount || "0");
    if (paidAmount < toUsdcUnits(priceUsdc)) {
      return { status: 402, paid: false, settled: false, body: { error: "Insufficient payment" } };
    }

    // Fallback accepted — payment proof is valid but NOT settled on-chain
    return { status: 200, paid: true, settled: false };
  } catch {
    return { status: 402, paid: false, settled: false, body: { error: "Payment verification failed" } };
  }
}

/**
 * Verify an x402 payment without settling (for pre-verification)
 */
export async function verifyX402Payment(
  request: Request,
  recipientWallet: string,
  maxPriceUsdc: number,
  description: string
): Promise<{ status: number; valid: boolean; body?: unknown }> {
  const paymentData =
    request.headers.get("X-PAYMENT") ||
    request.headers.get("PAYMENT-SIGNATURE");

  try {
    const x402Facilitator = createX402Facilitator(recipientWallet);

    const result = await thirdwebVerifyPayment({
      resourceUrl: request.url,
      method: request.method,
      paymentData,
      payTo: recipientWallet,
      network: monadTestnet,
      price: `$${maxPriceUsdc}`,
      facilitator: x402Facilitator,
      routeConfig: {
        description,
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
      },
    });

    return {
      status: result.status,
      valid: result.status === 200,
      body: result.status === 200 ? { decodedPayment: result.decodedPayment } : result,
    };
  } catch {
    return { status: 500, valid: false, body: { error: "Verification failed" } };
  }
}

/**
 * Task payment record for tracking operator-to-agent and cost sink payments
 */
export interface TaskPayment {
  id: string;
  fromEntity: string;
  toEntity: string;
  fromWallet: string;
  toWallet: string;
  amount: number;
  taskId?: string;
  taskType?: string;
  paymentType: "task_payment" | "operational_cost";
  txHash?: string;
  status: "pending" | "completed" | "failed";
  timestamp: Date;
}

/**
 * Task payment info for the delivery endpoint
 */
export interface TaskPaymentInfo {
  taskId: string;
  taskType: string;
  winningBidAmount: number;
  agentId: string;
  agentWalletAddress: string;
  operationalCost: number;
}

/**
 * Build TaskPaymentInfo from task and agent data
 */
export function getTaskPaymentInfo(
  task: { id: string; type: string; winning_bid_amount?: number },
  agent: { id: string; wallet_address: string },
  bidAmount: number
): TaskPaymentInfo {
  const taskType = task.type as TaskType;
  const operationalCost = TASK_OPERATIONAL_COSTS[taskType] || 0.05;

  return {
    taskId: task.id,
    taskType: task.type,
    winningBidAmount: bidAmount,
    agentId: agent.id,
    agentWalletAddress: agent.wallet_address,
    operationalCost,
  };
}

/**
 * Create a payment record for logging
 */
export function createPaymentRecord(
  fromEntity: string,
  toEntity: string,
  fromWallet: string,
  toWallet: string,
  paymentType: "task_payment" | "operational_cost",
  amount: number,
  options?: { taskId?: string; taskType?: string; txHash?: string }
): TaskPayment {
  return {
    id: `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    fromEntity,
    toEntity,
    fromWallet,
    toWallet,
    amount,
    taskId: options?.taskId,
    taskType: options?.taskType,
    paymentType,
    txHash: options?.txHash,
    status: options?.txHash ? "completed" : "pending",
    timestamp: new Date(),
  };
}

/**
 * Format a payment for the activity feed
 */
export function formatPaymentActivity(payment: TaskPayment): string {
  if (payment.paymentType === "task_payment") {
    return `Operator paid ${payment.toEntity} $${payment.amount.toFixed(4)} USDC for task ${payment.taskId || "unknown"}`;
  }
  return `${payment.fromEntity} paid $${payment.amount.toFixed(4)} USDC operational cost for ${payment.taskType || "task"}`;
}
