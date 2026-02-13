/**
 * USDC Balance Sync Processor
 *
 * Periodically reads on-chain USDC balances for all agents via multicall
 * and updates the DB when balances have changed.
 */

import { publicClient } from '../client';
import { CONTRACTS, USDC_DECIMALS } from '../config';
import { supabase } from '../../supabase';
import { formatUnits, isAddress } from 'viem';

const BALANCE_THRESHOLD = 0.0001; // Only update if diff > 0.0001 USDC
const SYNC_INTERVAL_MS = 10_000; // Check balances every 10s
const CACHE_REFRESH_MS = 30 * 60_000; // Refresh agent wallet list every 30 min

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

interface CachedAgent {
  id: string;
  name: string;
  wallet_address: string;
  balance: number;
}

let cachedAgents: CachedAgent[] = [];
let lastCacheRefresh = 0;
let lastSyncTime = 0;

/**
 * Sync USDC balances for all agents.
 * Internally throttled — safe to call every poll cycle.
 */
export async function syncUsdcBalances(): Promise<void> {
  // Throttle: only run every 10s
  if (Date.now() - lastSyncTime < SYNC_INTERVAL_MS) return;
  lastSyncTime = Date.now();

  // Refresh agent wallet cache if stale
  if (Date.now() - lastCacheRefresh > CACHE_REFRESH_MS) {
    const { data, error } = await supabase
      .from('agents')
      .select('id, name, wallet_address, balance')
      .not('wallet_address', 'is', null);

    if (error) {
      console.error('[USDC Sync] Failed to load agent wallets:', error.message);
      return;
    }

    // Filter out invalid/fake addresses (e.g. test agents with 0xCATALOG000...)
    cachedAgents = ((data || []) as CachedAgent[]).filter((a) => isAddress(a.wallet_address));
    lastCacheRefresh = Date.now();
    console.log(`[USDC Sync] Cached ${cachedAgents.length} agent wallets`);
  }

  if (cachedAgents.length === 0) return;

  try {
    // Multicall: batch all balanceOf() into 1 RPC call
    const results = await publicClient.multicall({
      contracts: cachedAgents.map((a) => ({
        address: CONTRACTS.MOCK_USDC as `0x${string}`,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf' as const,
        args: [a.wallet_address as `0x${string}`],
      })),
    });

    // Compare and update
    for (let i = 0; i < cachedAgents.length; i++) {
      const agent = cachedAgents[i];
      const result = results[i];
      if (result.status !== 'success') continue;

      const onChain = parseFloat(formatUnits(result.result as bigint, USDC_DECIMALS));
      const dbBalance = agent.balance || 0;

      if (Math.abs(onChain - dbBalance) > BALANCE_THRESHOLD) {
        const { error } = await supabase
          .from('agents')
          .update({ balance: onChain })
          .eq('id', agent.id);

        if (error) {
          console.error(`[USDC Sync] DB update failed for ${agent.name}:`, error.message);
          continue;
        }

        agent.balance = onChain; // update cache too
        console.log(
          `[USDC Sync] ${agent.name}: ${dbBalance.toFixed(4)} → ${onChain.toFixed(4)} USDC`
        );
      }
    }
  } catch (error) {
    console.error('[USDC Sync] Multicall failed:', (error as Error).message);
  }
}

/**
 * Read a single agent's on-chain USDC balance.
 * Used by API routes for real-time accuracy without requiring chain sync.
 * Also updates the DB if the balance has drifted.
 */
export async function getOnChainUsdcBalance(
  walletAddress: string,
  agentId?: string
): Promise<number> {
  if (!isAddress(walletAddress)) return 0;

  try {
    const result = await publicClient.readContract({
      address: CONTRACTS.MOCK_USDC as `0x${string}`,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [walletAddress as `0x${string}`],
    });

    const balance = parseFloat(formatUnits(result, USDC_DECIMALS));

    // Fire-and-forget DB update if agentId provided
    if (agentId) {
      supabase
        .from('agents')
        .update({ balance })
        .eq('id', agentId)
        .then(({ error }) => {
          if (error) console.error(`[USDC] DB update failed for ${agentId}:`, error.message);
        });
    }

    return balance;
  } catch (error) {
    console.error(`[USDC] Failed to read balance for ${walletAddress}:`, (error as Error).message);
    return 0;
  }
}

/**
 * Force refresh the agent wallet cache (e.g. after new agent creation)
 */
export function invalidateAgentCache(): void {
  lastCacheRefresh = 0;
}
