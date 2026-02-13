/**
 * Base Event Processor Utilities
 *
 * Shared helper functions for processing blockchain events
 */

import { formatEther, formatUnits } from 'viem';

/**
 * Retry a function with linear backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.warn(`Attempt ${attempt + 1}/${maxRetries} failed:`, error);

      if (attempt < maxRetries - 1) {
        // Wait before retrying (linear backoff)
        await sleep(delayMs * (attempt + 1));
      }
    }
  }

  throw lastError || new Error('All retry attempts failed');
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert wei (bigint) to a number (MON)
 * WARNING: May lose precision for very large values
 */
export function weiToNumber(wei: bigint): number {
  return Number(formatEther(wei));
}

/**
 * Convert USDC wei (bigint) to a number
 * WARNING: May lose precision for very large values
 */
export function usdcToNumber(wei: bigint): number {
  return Number(formatUnits(wei, 6));
}

/**
 * Convert reputation from contract scale (100-500) to decimal (1.0-5.0)
 */
export function reputationToDecimal(rep: bigint): number {
  return Number(rep) / 100;
}

/**
 * Convert reputation from decimal (1.0-5.0) to contract scale (100-500)
 */
export function reputationToContract(decimal: number): number {
  return Math.round(decimal * 100);
}

/**
 * Safely convert bigint to number (checks for overflow)
 */
export function bigintToNumber(value: bigint): number {
  const num = Number(value);

  if (!Number.isSafeInteger(num)) {
    console.warn(`BigInt value ${value} may lose precision when converted to number`);
  }

  return num;
}

/**
 * Format Ethereum address to checksum format
 */
export function toChecksumAddress(address: string): string {
  return address.toLowerCase(); // viem handles checksumming internally
}

/**
 * Extract log index from log (for deduplication)
 */
export function getLogIndex(log: any): number {
  return log.logIndex || 0;
}

/**
 * Create a unique key for event deduplication
 */
export function createEventKey(txHash: string, logIndex: number): string {
  return `${txHash}:${logIndex}`;
}

/**
 * Check if error is a database constraint violation (duplicate entry)
 */
export function isDuplicateError(error: any): boolean {
  const message = error?.message?.toLowerCase() || '';
  return message.includes('duplicate') || message.includes('unique constraint');
}

/**
 * Log event processing (for debugging)
 */
export function logEventProcessed(
  eventName: string,
  blockNumber: bigint,
  txHash: string,
  details?: Record<string, any>
): void {
  console.log(`[${eventName}] Block ${blockNumber} | ${txHash.slice(0, 10)}...`, details || '');
}

/**
 * Log event processing error
 */
export function logEventError(
  eventName: string,
  error: Error,
  blockNumber?: bigint,
  txHash?: string
): void {
  console.error(
    `[ERROR: ${eventName}]`,
    blockNumber ? `Block ${blockNumber}` : '',
    txHash ? `| ${txHash.slice(0, 10)}...` : '',
    error.message
  );
}
