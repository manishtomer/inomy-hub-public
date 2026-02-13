/**
 * Treasury Event Processor
 */

import { type Log } from 'viem';
import { weiToNumber, bigintToNumber, logEventProcessed } from '../event-processor';
import { createEconomyEvent } from '../economy-events';

export async function processTreasuryEvent(log: Log): Promise<void> {
  const eventName = (log as any).eventName;

  try {
    switch (eventName) {
      case 'Deposited': {
        const { amount } = (log as any).args;
        await createEconomyEvent({
          event_type: 'investment',
          description: `Treasury received ${weiToNumber(amount).toFixed(4)} MON`,
          amount: weiToNumber(amount),
          tx_hash: log.transactionHash ?? undefined,
          block_number: log.blockNumber != null ? bigintToNumber(log.blockNumber) : undefined,
        });
        break;
      }

      case 'WorkerPaid': {
        const { amount: paid } = (log as any).args;
        await createEconomyEvent({
          event_type: 'task_completed',
          description: `Worker paid ${weiToNumber(paid).toFixed(4)} MON`,
          amount: weiToNumber(paid),
          tx_hash: log.transactionHash ?? undefined,
          block_number: log.blockNumber != null ? bigintToNumber(log.blockNumber) : undefined,
        });
        break;
      }

      default:
        console.log(`[Treasury] ${eventName}`);
    }

    logEventProcessed(
      `Treasury.${eventName}`,
      log.blockNumber ?? 0n,
      log.transactionHash ?? '',
    );
  } catch (error) {
    console.error(`[Treasury] ${eventName} error:`, error);
  }
}
