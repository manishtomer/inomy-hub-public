/**
 * POST /api/operator-topup
 *
 * Checks operator wallet USDC balance. If below threshold, transfers
 * USDC from the deployer (cost sink) wallet to the operator wallet.
 *
 * This keeps the x402 payment loop running: operator pays agents,
 * agents pay cost sink, cost sink refills operator.
 *
 * Body: { threshold?: number, amount?: number }
 *   threshold: USDC balance below which we refill (default 5)
 *   amount: USDC to send when refilling (default 50)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  formatUnits,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from 'viem';

const USDC_ADDRESS = '0x534b2f3A21130d7a60830c2Df862319e593943A3' as Address;
const USDC_DECIMALS = 6;
const OPERATOR_WALLET = (process.env.THIRDWEB_WALLET_ADDRESS || '0xF573c5E3731834Bd574D627Ab9205E05f2540824') as Address;
const DEFAULT_THRESHOLD = 5; // refill when below 5 USDC
const DEFAULT_AMOUNT = 50;   // send 50 USDC

const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'to', type: 'address' as const },
      { name: 'amount', type: 'uint256' as const },
    ],
    outputs: [{ name: '', type: 'bool' as const }],
  },
  {
    name: 'balanceOf',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [{ name: 'account', type: 'address' as const }],
    outputs: [{ name: '', type: 'uint256' as const }],
  },
] as const;

const monadTestnet = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
} as const;

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const threshold = body.threshold ?? DEFAULT_THRESHOLD;
    const amount = body.amount ?? DEFAULT_AMOUNT;

    // Check operator balance
    const operatorBalance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [OPERATOR_WALLET],
    });
    const operatorUsdc = Number(formatUnits(operatorBalance, USDC_DECIMALS));

    if (operatorUsdc >= threshold) {
      return NextResponse.json({
        success: true,
        data: {
          action: 'none',
          operator_balance: operatorUsdc,
          threshold,
          message: `Operator balance ${operatorUsdc.toFixed(2)} USDC >= threshold ${threshold} USDC`,
        },
      });
    }

    // Need to refill — check deployer has private key
    let privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) {
      return NextResponse.json(
        { success: false, error: 'DEPLOYER_PRIVATE_KEY not set' },
        { status: 500 }
      );
    }
    if (!privateKey.startsWith('0x')) {
      privateKey = `0x${privateKey}`;
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`);

    // Check deployer balance
    const deployerBalance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    });
    const deployerUsdc = Number(formatUnits(deployerBalance, USDC_DECIMALS));

    // Cap the transfer at deployer's balance (keep 10 USDC reserve)
    const maxTransfer = Math.max(0, deployerUsdc - 10);
    const transferAmount = Math.min(amount, maxTransfer);

    if (transferAmount < 1) {
      return NextResponse.json({
        success: false,
        error: `Deployer has insufficient USDC (${deployerUsdc.toFixed(2)}). Cannot refill operator.`,
        data: {
          operator_balance: operatorUsdc,
          deployer_balance: deployerUsdc,
        },
      }, { status: 400 });
    }

    // Send USDC from deployer to operator
    const walletClient = createWalletClient({
      account,
      chain: monadTestnet,
      transport: http(),
    });

    const transferData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [OPERATOR_WALLET, parseUnits(transferAmount.toString(), USDC_DECIMALS)],
    });

    const hash = await walletClient.sendTransaction({
      to: USDC_ADDRESS,
      data: transferData,
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });

    // Read new balance
    const newBalance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [OPERATOR_WALLET],
    });
    const newUsdc = Number(formatUnits(newBalance, USDC_DECIMALS));

    console.log(`[OperatorTopup] Sent ${transferAmount} USDC to operator: ${operatorUsdc.toFixed(2)} -> ${newUsdc.toFixed(2)} (tx: ${hash})`);

    return NextResponse.json({
      success: true,
      data: {
        action: 'refilled',
        amount_sent: transferAmount,
        operator_balance_before: operatorUsdc,
        operator_balance_after: newUsdc,
        deployer_balance: deployerUsdc - transferAmount,
        tx_hash: hash,
        block: Number(receipt.blockNumber),
      },
    });
  } catch (err) {
    console.error('[OperatorTopup] Error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
