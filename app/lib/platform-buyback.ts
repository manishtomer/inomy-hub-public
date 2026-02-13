/**
 * Platform Token Buyback & Burn
 *
 * Uses deployer's MON to buy INOMY on nad.fun's bonding curve,
 * sending purchased tokens directly to the burn address.
 *
 * Flow:
 *   1. Quote: Lens.getAmountOut(INOMY, monAmount, isBuy=true) → expected tokens
 *   2. Buy:   BondingCurveRouter.buy({token: INOMY, to: BURN_ADDRESS, ...}) with MON
 *   3. Log:   Record platform_buyback economy event
 *
 * The `to` param in the router buy sends tokens directly to burn — one TX, no approve needed.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from './contracts';
import { lensAbi, routerBuyAbi, NAD_CONTRACTS } from './nadfun-client';
import { createEvent } from './api-helpers';
import {
  PLATFORM_TOKEN_ADDRESS,
  BURN_ADDRESS,
  BUYBACK_SLIPPAGE_BPS,
  BUYBACK_MIN_MON,
} from './platform-config';

// ── Types ───────────────────────────────────────────────────────────────────

export interface BuybackResult {
  success: boolean;
  monSpent: string;       // MON amount spent (formatted)
  tokensReceived: string; // INOMY tokens bought (formatted, from quote)
  tokensBurned: string;   // Same — all go to burn address
  txHash: Hash;
  blockNumber: number;
  error?: string;
}

export interface BuybackQuote {
  monAmount: string;       // MON input (formatted)
  expectedTokens: string;  // Expected INOMY output (formatted)
  minTokens: string;       // After slippage (formatted)
  router: Address;         // Router address from Lens
}

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Get a quote for buying INOMY with MON
 */
export async function getBuybackQuote(monAmount: string): Promise<BuybackQuote> {
  if (!PLATFORM_TOKEN_ADDRESS) {
    throw new Error('PLATFORM_TOKEN_ADDRESS not set — deploy INOMY token first');
  }

  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(),
  });

  const monWei = parseEther(monAmount);

  const [router, amountOut] = await publicClient.readContract({
    address: NAD_CONTRACTS.LENS,
    abi: lensAbi,
    functionName: 'getAmountOut',
    args: [PLATFORM_TOKEN_ADDRESS, monWei, true], // isBuy = true
  });

  // Apply slippage tolerance
  const slippageMultiplier = BigInt(10000 - BUYBACK_SLIPPAGE_BPS);
  const minAmountOut = (amountOut * slippageMultiplier) / 10000n;

  return {
    monAmount,
    expectedTokens: formatEther(amountOut),
    minTokens: formatEther(minAmountOut),
    router: router as Address,
  };
}

/**
 * Execute a buyback: buy INOMY with deployer's MON and burn it.
 *
 * @param monAmount - MON to spend (e.g. "0.05")
 * @param deployerPrivateKey - deployer wallet private key (defaults to env)
 */
export async function executeBuyback(
  monAmount: string,
  deployerPrivateKey?: string,
): Promise<BuybackResult> {
  const rawKey = deployerPrivateKey || process.env.DEPLOYER_PRIVATE_KEY;
  if (!rawKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY is required for buyback');
  }
  const privateKey = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;

  if (!PLATFORM_TOKEN_ADDRESS) {
    throw new Error('PLATFORM_TOKEN_ADDRESS not set — deploy INOMY token first');
  }

  const monWei = parseEther(monAmount);
  const minMon = parseEther(BUYBACK_MIN_MON);
  if (monWei < minMon) {
    throw new Error(`Buyback amount ${monAmount} MON is below minimum ${BUYBACK_MIN_MON} MON`);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(),
  });
  const walletClient = createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(),
  });

  console.log(`[Buyback] Deployer: ${account.address}`);
  console.log(`[Buyback] Buying INOMY with ${monAmount} MON...`);

  // 1. Get quote from Lens
  const quote = await getBuybackQuote(monAmount);
  console.log(`[Buyback] Quote: ${quote.expectedTokens} INOMY (min: ${quote.minTokens})`);

  const minAmountOut = parseEther(quote.minTokens);

  // 2. Buy INOMY via BondingCurveRouter — send directly to burn address
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 min deadline

  const hash = await walletClient.writeContract({
    address: NAD_CONTRACTS.BONDING_CURVE_ROUTER,
    abi: routerBuyAbi,
    functionName: 'buy',
    args: [
      {
        amountOutMin: minAmountOut,
        token: PLATFORM_TOKEN_ADDRESS,
        to: BURN_ADDRESS,
        deadline,
      },
    ],
    value: monWei,
  });

  console.log(`[Buyback] TX sent: ${hash}`);

  // 3. Wait for confirmation
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
  });

  if (receipt.status !== 'success') {
    const result: BuybackResult = {
      success: false,
      monSpent: monAmount,
      tokensReceived: '0',
      tokensBurned: '0',
      txHash: hash,
      blockNumber: Number(receipt.blockNumber),
      error: 'Transaction reverted',
    };
    return result;
  }

  console.log(`[Buyback] Confirmed in block ${receipt.blockNumber}`);
  console.log(`[Buyback] ${quote.expectedTokens} INOMY sent to burn: ${BURN_ADDRESS}`);

  // 4. Log economy event
  createEvent({
    event_type: 'platform_buyback',
    description: `Platform buyback: spent ${monAmount} MON, burned ~${quote.expectedTokens} INOMY`,
    amount: parseFloat(monAmount),
    metadata: {
      mon_spent: monAmount,
      tokens_expected: quote.expectedTokens,
      tokens_min: quote.minTokens,
      burn_address: BURN_ADDRESS,
      token_address: PLATFORM_TOKEN_ADDRESS,
      tx_hash: hash,
      block_number: Number(receipt.blockNumber),
    },
  }).catch((err) => console.error('[Buyback] Failed to log event:', err));

  return {
    success: true,
    monSpent: monAmount,
    tokensReceived: quote.expectedTokens,
    tokensBurned: quote.expectedTokens,
    txHash: hash,
    blockNumber: Number(receipt.blockNumber),
  };
}
