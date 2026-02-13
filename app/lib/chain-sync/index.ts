/**
 * Chain Sync Service - Main Export
 */

export {
  startSyncService,
  stopSyncService,
  syncHistorical,
  getSyncStatus,
} from './sync-engine';

export { CONTRACTS, SYNC_CONFIG } from './config';
export { publicClient, verifyNetwork, checkRpcConnection } from './client';
export { getAllSyncStates, getLastSyncedBlock, resetSyncState } from './block-tracker';
