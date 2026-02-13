/**
 * POST /api/gas-topup
 *
 * Sends 0.5 MON from deployer wallet to any wallet with < 0.5 MON balance.
 * Used for both user wallets (on login) and agent wallets (during rounds).
 *
 * Body: { wallet: string } OR { wallets: string[] }
 * Returns: { success, data: { topped_up, skipped, results } }
 */

import { NextResponse, NextRequest } from 'next/server';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from '@/lib/contracts';

const MON_THRESHOLD = parseEther('0.5');
const MON_TOPUP_AMOUNT = parseEther('0.5');

function getDeployerAccount() {
  const rawKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rawKey) return null;
  const privateKey = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
  return privateKeyToAccount(privateKey as `0x${string}`);
}

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
});

const walletClient = createWalletClient({
  chain: monadTestnet,
  transport: http(),
});

type TopUpResult = { address: string; action: 'topped_up' | 'skipped' | 'error'; balance?: string; txHash?: string; error?: string };

async function topUpWallet(address: string): Promise<TopUpResult> {
  try {
    const account = getDeployerAccount();
    if (!account) return { address, action: 'error', error: 'Deployer key not configured' };

    const balance = await publicClient.getBalance({
      address: address as `0x${string}`,
    });

    if (balance >= MON_THRESHOLD) {
      return { address, action: 'skipped', balance: formatEther(balance) };
    }

    const hash = await walletClient.sendTransaction({
      account,
      to: address as `0x${string}`,
      value: MON_TOPUP_AMOUNT,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'success') {
      console.log(`[Gas Top-Up] Sent 0.5 MON to ${address.slice(0, 10)}... - TX: ${hash}`);
      return { address, action: 'topped_up', balance: formatEther(balance), txHash: hash };
    } else {
      return { address, action: 'error', error: 'Transaction reverted' };
    }
  } catch (err) {
    console.error(`[Gas Top-Up] Error for ${address}:`, err);
    return { address, action: 'error', error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const wallets: string[] = body.wallets || (body.wallet ? [body.wallet] : []);

    if (wallets.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Provide wallet or wallets' },
        { status: 400 }
      );
    }

    if (!getDeployerAccount()) {
      return NextResponse.json(
        { success: false, error: 'Deployer key not configured' },
        { status: 500 }
      );
    }

    const results: TopUpResult[] = [];
    let toppedUp = 0;
    let skipped = 0;

    // Process sequentially to avoid nonce issues
    for (const addr of wallets) {
      const result = await topUpWallet(addr);
      results.push(result);
      if (result.action === 'topped_up') toppedUp++;
      if (result.action === 'skipped') skipped++;
    }

    return NextResponse.json({
      success: true,
      data: { topped_up: toppedUp, skipped, results },
    });
  } catch (error) {
    console.error('[Gas Top-Up] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
