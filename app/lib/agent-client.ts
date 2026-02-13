/**
 * Operator Client - Operator-to-Agent Payments via x402
 *
 * The operator (deployer wallet) pays winning agents for completed tasks
 * using the x402 payment protocol via Thirdweb.
 *
 * Two modes:
 * 1. With Thirdweb wallet: Uses wrapFetchWithPayment for real on-chain payments
 * 2. Without wallet: Uses manual payment proof (for development/testing)
 */

import { wrapFetchWithPayment } from "thirdweb/x402";
import { createThirdwebClient, Engine } from "thirdweb";
import type { ThirdwebClient } from "thirdweb";
import { monadTestnet } from "thirdweb/chains";
import {
  TaskPayment,
  createPaymentRecord,
  COST_SINK_WALLET,
} from "./x402";
import { createClientSideThirdwebClient } from "./thirdweb-client";

export interface TaskDeliveryResult<T = unknown> {
  success: boolean;
  data?: T;
  payment?: TaskPayment;
  error?: string;
}

export interface OperatorClientConfig {
  baseUrl?: string;
  thirdwebClient?: ThirdwebClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wallet?: any; // Thirdweb Wallet instance
}

/**
 * Operator Client for paying agents via x402 after task completion
 *
 * The operator wallet (= deployer wallet = cost sink wallet) calls
 * POST /api/task-delivery/[taskId] with x402 payment to pay the winning agent.
 */
export class OperatorClient {
  private operatorWallet: string;
  private baseUrl: string;
  private paymentHistory: TaskPayment[] = [];
  private payingFetch: typeof fetch;

  constructor(
    operatorWallet: string = COST_SINK_WALLET,
    config: OperatorClientConfig = {}
  ) {
    this.operatorWallet = operatorWallet;
    this.baseUrl = config.baseUrl || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:4000";

    // If thirdweb wallet is provided, use wrapFetchWithPayment for real payments
    if (config.wallet && config.thirdwebClient) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.payingFetch = wrapFetchWithPayment(fetch, config.thirdwebClient, config.wallet) as any;
    } else {
      // Fall back to manual payment proof
      this.payingFetch = createManualPayingFetch(this.operatorWallet);
    }
  }

  /**
   * Pay the winning agent for a completed task via x402
   *
   * Calls POST /api/task-delivery/[taskId] with x402 payment proof.
   * The endpoint looks up the winning bid from DB (the bid IS the x402
   * payment requirement), settles payment, deducts operational cost,
   * and returns the task result.
   *
   * No body needed — the endpoint derives price, agent, and task type
   * from the winning bid record.
   */
  async payForTask<T = unknown>(
    taskId: string
  ): Promise<TaskDeliveryResult<T>> {
    const url = new URL(
      `/api/task-delivery/${taskId}`,
      this.baseUrl
    );

    try {
      const response = await this.payingFetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Operator-Wallet": this.operatorWallet,
        },
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const data = await response.json();

      const payment = createPaymentRecord(
        "operator",
        data.agentId,
        this.operatorWallet,
        data.agentWallet || data.agentId,
        "task_payment",
        data.bidAmount,
        { taskId, taskType: data.taskType, txHash: data.payment?.txHash }
      );
      payment.status = "completed";
      this.paymentHistory.push(payment);

      return { success: true, data, payment };
    } catch (error) {
      return {
        success: false,
        error: `Task payment failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  getPaymentHistory(): TaskPayment[] {
    return [...this.paymentHistory];
  }

  getTotalSpent(): number {
    return this.paymentHistory
      .filter((p) => p.status === "completed")
      .reduce((sum, p) => sum + p.amount, 0);
  }
}

/**
 * Create a fetch function with manual payment proof (fallback mode)
 */
export function createManualPayingFetch(walletAddress: string): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Make initial request
    const response = await fetch(input, init);

    // If not 402, return as-is
    if (response.status !== 402) {
      return response;
    }

    // Extract payment requirements from 402 response
    const requirementsHeader = response.headers.get("X-Payment-Requirements");
    let requirements;
    if (requirementsHeader) {
      try {
        requirements = JSON.parse(requirementsHeader);
      } catch {
        // Try body
      }
    }
    if (!requirements) {
      try {
        const body = await response.json();
        requirements = body.paymentRequirements;
      } catch {
        return response;
      }
    }

    if (!requirements) return response;

    // Create payment proof
    const payload = {
      scheme: requirements.scheme,
      network: requirements.network,
      amount: requirements.maxAmountRequired,
      asset: requirements.asset,
      payTo: requirements.payTo,
      payFrom: walletAddress,
      validUntil: Math.floor(Date.now() / 1000) + 3600,
      nonce: Date.now().toString(),
    };

    const signature = `0x${Buffer.from(JSON.stringify(payload)).toString("hex").slice(0, 130)}`;
    const paymentProof = { payload, signature, txHash: `0x${Date.now().toString(16)}${"0".repeat(40)}` };

    // Retry with payment
    const paidInit = { ...init, headers: { ...(init?.headers || {}), "X-Payment": JSON.stringify(paymentProof) } };
    return fetch(input, paidInit);
  };
}

/**
 * Create an operator client with default config
 */
export function createOperatorClient(
  config?: OperatorClientConfig
): OperatorClient {
  return new OperatorClient(COST_SINK_WALLET, config);
}

/**
 * Create an operator client with real Thirdweb wallet for on-chain payments
 */
export function createOperatorClientWithWallet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wallet: any,
  config?: Omit<OperatorClientConfig, "wallet" | "thirdwebClient">
): OperatorClient {
  const thirdwebClient = createClientSideThirdwebClient();
  return new OperatorClient(COST_SINK_WALLET, {
    ...config,
    thirdwebClient,
    wallet,
  });
}

/**
 * Create a server-side x402-paying fetch for the operator.
 *
 * If THIRDWEB_SECRET_KEY and THIRDWEB_WALLET_ADDRESS are set:
 *   → Uses Engine.serverWallet + wrapFetchWithPayment for real on-chain x402 payments
 * Otherwise:
 *   → Falls back to createManualPayingFetch (passes x402 fallback verification, no real transfer)
 *
 * This is the SAME paying fetch that production and simulation should both use.
 */
export function createServerPayingFetch(): typeof fetch {
  const secretKey = process.env.THIRDWEB_SECRET_KEY;
  const walletAddress = process.env.THIRDWEB_WALLET_ADDRESS;
  const operatorWallet = process.env.COST_SINK_WALLET_ADDRESS || COST_SINK_WALLET;

  if (secretKey && walletAddress) {
    // Real x402 with Thirdweb Engine server wallet
    const client = createThirdwebClient({ secretKey });
    const operatorAccount = Engine.serverWallet({
      client,
      address: walletAddress,
      chain: monadTestnet,
    });

    // wrapFetchWithPayment expects a Wallet (getAccount/getChain), not an Account
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walletWrapper: any = {
      id: "engine",
      getAccount: () => operatorAccount,
      getChain: () => monadTestnet,
      switchChain: async () => {},
      connect: async () => operatorAccount,
      autoConnect: async () => operatorAccount,
      disconnect: async () => {},
      subscribe: () => () => {},
      getConfig: () => undefined,
    };

    console.log(`[OperatorPayingFetch] Using real x402 with Thirdweb Engine wallet: ${walletAddress}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return wrapFetchWithPayment(fetch, client, walletWrapper) as any;
  }

  // Fallback: manual payment proof (development mode)
  console.log(`[OperatorPayingFetch] Using manual payment proof (set THIRDWEB_SECRET_KEY + THIRDWEB_WALLET_ADDRESS for real x402)`);
  return createManualPayingFetch(operatorWallet);
}
