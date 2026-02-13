/**
 * Viem Client for Chain Sync
 *
 * Configured public client with retry logic for reading blockchain data
 */

import { createPublicClient, http } from 'viem';
import { SYNC_CONFIG } from './config';

// ============================================================================
// Chain Definition (Monad Testnet)
// ============================================================================

export const monadTestnet = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: {
    name: 'Monad',
    symbol: 'MON',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [SYNC_CONFIG.RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: 'Monad Explorer',
      url: 'https://testnet.monadvision.com',
    },
  },
} as const;

// ============================================================================
// Public Client with Retry Logic
// ============================================================================

/**
 * Create a public client with retry configuration
 */
export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(SYNC_CONFIG.RPC_URL, {
    retryCount: 3,
    retryDelay: 1000,
    timeout: 30000,
  }),
});

/**
 * Get the current block number
 */
export async function getCurrentBlock(): Promise<bigint> {
  return await publicClient.getBlockNumber();
}

/**
 * Get block timestamp
 */
export async function getBlockTimestamp(blockNumber: bigint): Promise<bigint> {
  const block = await publicClient.getBlock({ blockNumber });
  return block.timestamp;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check RPC connectivity
 */
export async function checkRpcConnection(): Promise<boolean> {
  try {
    await publicClient.getBlockNumber();
    return true;
  } catch (error) {
    console.error('RPC connection failed:', error);
    return false;
  }
}

/**
 * Get chain ID to verify we're on the right network
 */
export async function getChainId(): Promise<number> {
  return await publicClient.getChainId();
}

/**
 * Verify we're connected to Monad Testnet
 */
export async function verifyNetwork(): Promise<void> {
  const chainId = await getChainId();

  if (chainId !== SYNC_CONFIG.CHAIN_ID) {
    throw new Error(
      `Wrong network: expected chain ID ${SYNC_CONFIG.CHAIN_ID}, got ${chainId}`
    );
  }

  console.log(`Connected to Monad Testnet (chain ID: ${chainId})`);
}
