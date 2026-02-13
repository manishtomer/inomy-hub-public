/**
 * Chain Sync Service Configuration
 *
 * Defines contract addresses, RPC settings, and enum mappings for blockchain sync
 */

// ============================================================================
// Contract Addresses (Monad Testnet)
// ============================================================================

export const CONTRACTS = {
  TREASURY: '0x8723Ab32451C9114143b9784c885fd7eBdBBC490' as const,
  AGENT_REGISTRY: '0xe7dAD10C1274c9E6bb885b36c617b0d310DEF199' as const,
  TASK_AUCTION: '0x96dF572c3242631d3Cff4EbCb640971cfb96F833' as const,
  INTENT_AUCTION: '0x48ECD487a9FE688a2904188549a5117def49207e' as const,
  PARTNERSHIP: '0xE73655CEb012795CE82E5e92aa50FF9D09eEB0fd' as const,
  MOCK_USDC: '0x534b2f3A21130d7a60830c2Df862319e593943A3' as const,
} as const;

// ============================================================================
// Token Constants
// ============================================================================

export const USDC_DECIMALS = 6;

// ============================================================================
// Sync Configuration
// ============================================================================

export const SYNC_CONFIG = {
  // RPC endpoint
  RPC_URL: process.env.MONAD_RPC_URL || process.env.NEXT_PUBLIC_MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz',

  // Polling interval for live sync (ms)
  POLL_INTERVAL_MS: parseInt(process.env.CHAIN_SYNC_POLL_INTERVAL_MS || '2000', 10),

  // Chunk size for historical sync (blocks per query)
  HISTORICAL_CHUNK_SIZE: parseInt(process.env.CHAIN_SYNC_HISTORICAL_CHUNK_SIZE || '2000', 10),

  // Starting block for historical sync (0 = from genesis)
  START_BLOCK: parseInt(process.env.CHAIN_SYNC_START_BLOCK || '0', 10),

  // Chain ID
  CHAIN_ID: 10143,
} as const;

// ============================================================================
// Solidity Enum -> TypeScript String Mappings
// ============================================================================

/**
 * AgentType enum (from AgentRegistry.sol)
 * enum AgentType { CATALOG, REVIEW, CURATION, SELLER }
 */
export const AGENT_TYPE_MAP: Record<number, string> = {
  0: 'CATALOG',
  1: 'REVIEW',
  2: 'CURATION',
  3: 'SELLER',
} as const;

/**
 * AgentStatus enum (from AgentRegistry.sol)
 * enum AgentStatus { UNFUNDED, ACTIVE, LOW_FUNDS, PAUSED, DEAD }
 */
export const AGENT_STATUS_MAP: Record<number, string> = {
  0: 'UNFUNDED',
  1: 'ACTIVE',
  2: 'LOW_FUNDS',
  3: 'PAUSED',
  4: 'DEAD',
} as const;

/**
 * TaskType enum (from TaskAuction.sol)
 * enum TaskType { CATALOG, REVIEW, CURATION, BUNDLED }
 */
export const TASK_TYPE_MAP: Record<number, string> = {
  0: 'CATALOG',
  1: 'REVIEW',
  2: 'CURATION',
  3: 'BUNDLED',
} as const;

/**
 * TaskStatus enum (from TaskAuction.sol)
 * enum TaskStatus { Open, Bidding, Assigned, Completed, Verified, Failed, Cancelled }
 */
export const TASK_STATUS_MAP: Record<number, string> = {
  0: 'OPEN',      // Open
  1: 'OPEN',      // Bidding (alias for Open)
  2: 'ASSIGNED',  // Assigned
  3: 'COMPLETED', // Completed
  4: 'VERIFIED',  // Verified
  5: 'FAILED',    // Failed
  6: 'CANCELLED', // Cancelled
} as const;

/**
 * BidStatus enum (from TaskAuction.sol)
 * enum BidStatus { Pending, Won, Lost, Withdrawn }
 */
export const BID_STATUS_MAP: Record<number, string> = {
  0: 'PENDING',
  1: 'WON',
  2: 'LOST',
  3: 'WITHDRAWN',
} as const;

/**
 * IntentStatus enum (from IntentAuction.sol)
 * enum IntentStatus { Open, Auction, Closed, Expired, Fulfilled, Disputed }
 */
export const INTENT_STATUS_MAP: Record<number, string> = {
  0: 'OPEN',      // Open
  1: 'OPEN',      // Auction (alias for Open)
  2: 'MATCHED',   // Closed -> MATCHED in our DB
  3: 'EXPIRED',   // Expired
  4: 'FULFILLED', // Fulfilled
  5: 'DISPUTED',  // Disputed
} as const;

/**
 * OfferStatus enum (from IntentAuction.sol)
 * enum OfferStatus { Pending, Won, Lost, Withdrawn }
 */
export const OFFER_STATUS_MAP: Record<number, string> = {
  0: 'PENDING',
  1: 'ACCEPTED',  // Won -> ACCEPTED in our DB
  2: 'REJECTED',  // Lost -> REJECTED in our DB
  3: 'WITHDRAWN',
} as const;

/**
 * PartnershipStatus enum (from Partnership.sol)
 * enum PartnershipStatus { Active, Dissolving, Dissolved }
 */
export const PARTNERSHIP_STATUS_MAP: Record<number, string> = {
  0: 'ACTIVE',
  1: 'DISSOLVING',
  2: 'DISSOLVED',
} as const;

/**
 * ProposalStatus enum (from Partnership.sol)
 * enum ProposalStatus { Pending, Accepted, Rejected, CounterOffered, Expired, Withdrawn }
 */
export const PROPOSAL_STATUS_MAP: Record<number, string> = {
  0: 'PENDING',
  1: 'ACCEPTED',
  2: 'REJECTED',
  3: 'NEGOTIATING', // CounterOffered -> NEGOTIATING in our DB
  4: 'EXPIRED',
  5: 'WITHDRAWN',
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get contract name from address
 */
export function getContractName(address: string): string | null {
  const normalized = address.toLowerCase();

  if (normalized === CONTRACTS.AGENT_REGISTRY.toLowerCase()) return 'AgentRegistry';
  if (normalized === CONTRACTS.TASK_AUCTION.toLowerCase()) return 'TaskAuction';
  if (normalized === CONTRACTS.INTENT_AUCTION.toLowerCase()) return 'IntentAuction';
  if (normalized === CONTRACTS.PARTNERSHIP.toLowerCase()) return 'Partnership';
  if (normalized === CONTRACTS.TREASURY.toLowerCase()) return 'Treasury';

  return null;
}

/**
 * Validate configuration on startup
 */
export function validateConfig(): void {
  if (!SYNC_CONFIG.RPC_URL) {
    throw new Error('RPC_URL is required for chain sync');
  }

  if (SYNC_CONFIG.POLL_INTERVAL_MS < 1000) {
    console.warn('POLL_INTERVAL_MS is less than 1000ms, this may cause rate limiting');
  }

  if (SYNC_CONFIG.HISTORICAL_CHUNK_SIZE > 10000) {
    console.warn('HISTORICAL_CHUNK_SIZE is very large, this may cause RPC timeouts');
  }

  console.log('Chain Sync Config validated:', {
    rpc: SYNC_CONFIG.RPC_URL,
    pollInterval: `${SYNC_CONFIG.POLL_INTERVAL_MS}ms`,
    chunkSize: SYNC_CONFIG.HISTORICAL_CHUNK_SIZE,
    startBlock: SYNC_CONFIG.START_BLOCK,
  });
}
