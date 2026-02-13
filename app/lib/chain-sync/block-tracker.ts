/**
 * Block Tracker
 *
 * Tracks last synced block for each contract in the database
 */

import { supabase } from '../supabase';

export interface SyncState {
  id: string;
  contract_name: string;
  contract_address: string;
  last_synced_block: number;
  last_sync_at: string;
  sync_status: 'idle' | 'syncing' | 'error';
  error_message: string | null;
}

/**
 * Get the last synced block number for a contract
 */
export async function getLastSyncedBlock(contractName: string): Promise<bigint> {
  const { data, error } = await supabase
    .from('chain_sync_state')
    .select('last_synced_block')
    .eq('contract_name', contractName)
    .single();

  if (error) {
    console.error(`Error fetching sync state for ${contractName}:`, error);
    return 0n;
  }

  return BigInt(data?.last_synced_block || 0);
}

/**
 * Update the last synced block for a contract
 */
export async function updateLastSyncedBlock(
  contractName: string,
  blockNumber: bigint
): Promise<void> {
  const { error } = await supabase
    .from('chain_sync_state')
    .update({
      last_synced_block: Number(blockNumber),
      last_sync_at: new Date().toISOString(),
      sync_status: 'idle',
      error_message: null,
    })
    .eq('contract_name', contractName);

  if (error) {
    console.error(`Error updating sync state for ${contractName}:`, error);
    throw error;
  }
}

/**
 * Set sync status to 'syncing'
 */
export async function setSyncingStatus(contractName: string): Promise<void> {
  const { error } = await supabase
    .from('chain_sync_state')
    .update({
      sync_status: 'syncing',
      error_message: null,
    })
    .eq('contract_name', contractName);

  if (error) {
    console.error(`Error setting syncing status for ${contractName}:`, error);
  }
}

/**
 * Set sync status to 'error' with message
 */
export async function setSyncError(
  contractName: string,
  errorMessage: string
): Promise<void> {
  const { error } = await supabase
    .from('chain_sync_state')
    .update({
      sync_status: 'error',
      error_message: errorMessage,
    })
    .eq('contract_name', contractName);

  if (error) {
    console.error(`Error setting error status for ${contractName}:`, error);
  }
}

/**
 * Get all sync states
 */
export async function getAllSyncStates(): Promise<SyncState[]> {
  const { data, error } = await supabase
    .from('chain_sync_state')
    .select('*')
    .order('contract_name');

  if (error) {
    console.error('Error fetching all sync states:', error);
    return [];
  }

  return data || [];
}

/**
 * Get sync state for a specific contract
 */
export async function getSyncState(contractName: string): Promise<SyncState | null> {
  const { data, error } = await supabase
    .from('chain_sync_state')
    .select('*')
    .eq('contract_name', contractName)
    .single();

  if (error) {
    console.error(`Error fetching sync state for ${contractName}:`, error);
    return null;
  }

  return data;
}

/**
 * Reset sync state for a contract (useful for debugging)
 */
export async function resetSyncState(
  contractName: string,
  toBlock: bigint = 0n
): Promise<void> {
  const { error } = await supabase
    .from('chain_sync_state')
    .update({
      last_synced_block: Number(toBlock),
      sync_status: 'idle',
      error_message: null,
      last_sync_at: new Date().toISOString(),
    })
    .eq('contract_name', contractName);

  if (error) {
    console.error(`Error resetting sync state for ${contractName}:`, error);
    throw error;
  }

  console.log(`Reset sync state for ${contractName} to block ${toBlock}`);
}
