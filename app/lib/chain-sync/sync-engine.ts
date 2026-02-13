/**
 * Chain Sync Engine
 *
 * Manages historical and live blockchain event synchronization
 */

import { publicClient, getCurrentBlock } from './client';
import { CONTRACTS, SYNC_CONFIG } from './config';
import {
  getLastSyncedBlock,
  updateLastSyncedBlock,
  setSyncingStatus,
  setSyncError,
  getAllSyncStates,
} from './block-tracker';
import {
  AGENT_REGISTRY_EVENTS,
  AGENT_TOKEN_EVENTS,
  TASK_AUCTION_EVENTS,
  INTENT_AUCTION_EVENTS,
  PARTNERSHIP_EVENTS,
  TREASURY_EVENTS,
} from './abis';
import { processAgentRegistryEvent } from './processors/agent-registry';
import { processAgentTokenEvent } from './processors/agent-token';
import { processTaskAuctionEvent } from './processors/task-auction';
import { processIntentAuctionEvent } from './processors/intent-auction';
import { processPartnershipEvent } from './processors/partnership';
import { processTreasuryEvent } from './processors/treasury';
import { syncUsdcBalances } from './processors/usdc-balance';
import { sleep } from './event-processor';
import { supabase } from '../supabase';

export class SyncEngine {
  private isRunning = false;
  private knownTokenAddresses = new Set<string>();

  /**
   * Load known AgentToken addresses from database
   */
  async loadAgentTokenAddresses(): Promise<void> {
    const { data } = await supabase
      .from('agent_token_addresses')
      .select('token_address');

    if (data) {
      data.forEach((row) => {
        this.knownTokenAddresses.add(row.token_address.toLowerCase());
      });
    }

    console.log(`[SyncEngine] Loaded ${this.knownTokenAddresses.size} known token addresses`);
  }

  /**
   * Sync historical events from a specific block
   */
  async syncHistorical(fromBlock?: bigint): Promise<void> {
    console.log('[SyncEngine] Starting historical sync...');

    const currentBlock = await getCurrentBlock();
    const contracts = [
      { name: 'AgentRegistry', address: CONTRACTS.AGENT_REGISTRY, abi: AGENT_REGISTRY_EVENTS },
      { name: 'TaskAuction', address: CONTRACTS.TASK_AUCTION, abi: TASK_AUCTION_EVENTS },
      { name: 'IntentAuction', address: CONTRACTS.INTENT_AUCTION, abi: INTENT_AUCTION_EVENTS },
      { name: 'Partnership', address: CONTRACTS.PARTNERSHIP, abi: PARTNERSHIP_EVENTS },
      { name: 'Treasury', address: CONTRACTS.TREASURY, abi: TREASURY_EVENTS },
    ];

    for (const contract of contracts) {
      try {
        await setSyncingStatus(contract.name);

        const lastSynced = fromBlock || (await getLastSyncedBlock(contract.name));
        const startBlock = lastSynced === 0n ? BigInt(SYNC_CONFIG.START_BLOCK) : lastSynced + 1n;

        console.log(
          `[${contract.name}] Syncing from block ${startBlock} to ${currentBlock}...`
        );

        // Sync in chunks
        for (
          let fromBlockChunk = startBlock;
          fromBlockChunk <= currentBlock;
          fromBlockChunk += BigInt(SYNC_CONFIG.HISTORICAL_CHUNK_SIZE)
        ) {
          const toBlockChunk = (fromBlockChunk + BigInt(SYNC_CONFIG.HISTORICAL_CHUNK_SIZE) - 1n) > currentBlock
            ? currentBlock
            : fromBlockChunk + BigInt(SYNC_CONFIG.HISTORICAL_CHUNK_SIZE) - 1n;

          console.log(
            `[${contract.name}] Fetching logs: ${fromBlockChunk} -> ${toBlockChunk}`
          );

          const logs = await publicClient.getLogs({
            address: contract.address,
            events: contract.abi as any,
            fromBlock: fromBlockChunk,
            toBlock: toBlockChunk,
          });

          console.log(`[${contract.name}] Processing ${logs.length} logs...`);

          for (const log of logs) {
            await this.routeLog(log, contract.address);
          }

          // Update last synced block after each chunk
          await updateLastSyncedBlock(contract.name, toBlockChunk);
        }

        console.log(`[${contract.name}] Historical sync complete!`);
      } catch (error) {
        const errorMsg = `Historical sync failed: ${(error as Error).message}`;
        console.error(`[${contract.name}] ${errorMsg}`);
        await setSyncError(contract.name, errorMsg);
      }
    }

    // Reconcile USDC balances after historical sync
    console.log('[SyncEngine] Reconciling USDC balances...');
    await syncUsdcBalances();

    console.log('[SyncEngine] Historical sync complete for all contracts!');
  }

  /**
   * Start live sync (polls for new events)
   */
  async startLiveSync(): Promise<void> {
    if (this.isRunning) {
      console.warn('[SyncEngine] Live sync already running');
      return;
    }

    this.isRunning = true;
    console.log('[SyncEngine] Starting live sync...');

    // Load token addresses
    await this.loadAgentTokenAddresses();

    while (this.isRunning) {
      try {
        const currentBlock = await getCurrentBlock();

        const contracts = [
          { name: 'AgentRegistry', address: CONTRACTS.AGENT_REGISTRY, abi: AGENT_REGISTRY_EVENTS },
          { name: 'TaskAuction', address: CONTRACTS.TASK_AUCTION, abi: TASK_AUCTION_EVENTS },
          { name: 'IntentAuction', address: CONTRACTS.INTENT_AUCTION, abi: INTENT_AUCTION_EVENTS },
          { name: 'Partnership', address: CONTRACTS.PARTNERSHIP, abi: PARTNERSHIP_EVENTS },
          { name: 'Treasury', address: CONTRACTS.TREASURY, abi: TREASURY_EVENTS },
        ];

        for (const contract of contracts) {
          const lastSynced = await getLastSyncedBlock(contract.name);

          if (lastSynced < currentBlock) {
            const fromBlock = lastSynced + 1n;

            const logs = await publicClient.getLogs({
              address: contract.address,
              events: contract.abi as any,
              fromBlock,
              toBlock: currentBlock,
            });

            if (logs.length > 0) {
              console.log(
                `[${contract.name}] Processing ${logs.length} new events (block ${fromBlock} -> ${currentBlock})`
              );

              for (const log of logs) {
                await this.routeLog(log, contract.address);
              }
            }

            await updateLastSyncedBlock(contract.name, currentBlock);
          }
        }

        // Also sync AgentToken contracts
        await this.syncAgentTokens(currentBlock);

        // Sync USDC balances (internally throttled to every 10s)
        await syncUsdcBalances();

        // Wait before next poll
        await sleep(SYNC_CONFIG.POLL_INTERVAL_MS);
      } catch (error) {
        console.error('[SyncEngine] Live sync error:', error);
        await sleep(SYNC_CONFIG.POLL_INTERVAL_MS * 2); // Back off on error
      }
    }
  }

  /**
   * Sync all known AgentToken contracts
   */
  private async syncAgentTokens(currentBlock: bigint): Promise<void> {
    // Reload token addresses periodically (new agents may have been created)
    if (Math.random() < 0.1) {
      // 10% chance each poll
      await this.loadAgentTokenAddresses();
    }

    for (const tokenAddress of this.knownTokenAddresses) {
      try {
        // Get last synced block for this token (use agent_token_addresses table or default to 0)
        const { data } = await supabase
          .from('agent_token_addresses')
          .select('created_at_block')
          .eq('token_address', tokenAddress)
          .single();

        const fromBlock = BigInt(data?.created_at_block || 0);

        if (fromBlock < currentBlock) {
          const logs = await publicClient.getLogs({
            address: tokenAddress as `0x${string}`,
            events: AGENT_TOKEN_EVENTS as any,
            fromBlock,
            toBlock: currentBlock,
          });

          for (const log of logs) {
            await processAgentTokenEvent(log, tokenAddress);
          }
        }
      } catch (error) {
        console.error(`[AgentToken] Error syncing ${tokenAddress}:`, error);
      }
    }
  }

  /**
   * Stop live sync
   */
  stop(): void {
    console.log('[SyncEngine] Stopping live sync...');
    this.isRunning = false;
  }

  /**
   * Route a log to the appropriate processor
   */
  private async routeLog(log: any, contractAddress: string): Promise<void> {
    const normalized = contractAddress.toLowerCase();

    // Check if it's an AgentToken
    if (this.knownTokenAddresses.has(normalized)) {
      await processAgentTokenEvent(log, normalized);
      return;
    }

    // Route to contract-specific processors
    if (normalized === CONTRACTS.AGENT_REGISTRY.toLowerCase()) {
      await processAgentRegistryEvent(log);
    } else if (normalized === CONTRACTS.TASK_AUCTION.toLowerCase()) {
      await processTaskAuctionEvent(log);
    } else if (normalized === CONTRACTS.INTENT_AUCTION.toLowerCase()) {
      await processIntentAuctionEvent(log);
    } else if (normalized === CONTRACTS.PARTNERSHIP.toLowerCase()) {
      await processPartnershipEvent(log);
    } else if (normalized === CONTRACTS.TREASURY.toLowerCase()) {
      await processTreasuryEvent(log);
    } else {
      console.warn(`[SyncEngine] Unknown contract: ${contractAddress}`);
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

let syncEngine: SyncEngine | null = null;

export async function startSyncService(mode: 'live' | 'historical' = 'live'): Promise<void> {
  if (syncEngine) {
    console.warn('[SyncEngine] Service already running');
    return;
  }

  syncEngine = new SyncEngine();

  if (mode === 'historical') {
    await syncEngine.syncHistorical();
  } else {
    await syncEngine.startLiveSync();
  }
}

export function stopSyncService(): void {
  if (syncEngine) {
    syncEngine.stop();
    syncEngine = null;
  }
}

export async function syncHistorical(fromBlock?: bigint): Promise<void> {
  const engine = new SyncEngine();
  await engine.syncHistorical(fromBlock);
}

export async function getSyncStatus(): Promise<any[]> {
  return await getAllSyncStates();
}
