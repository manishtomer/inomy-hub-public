/**
 * TaskAuction Event Processor
 *
 * Processes events from the TaskAuction contract
 */

import { type Log } from 'viem';
import { supabase } from '../../supabase';
import {
  weiToNumber,
  bigintToNumber,
  isDuplicateError,
  logEventProcessed,
  logEventError,
} from '../event-processor';
import { TASK_TYPE_MAP } from '../config';
import { createEconomyEvent } from '../economy-events';

/**
 * Process TaskCreated event
 * Event: TaskCreated(uint256 indexed taskId, TaskType taskType, bytes32 inputHash,
 *                    uint256 maxBid, uint256 biddingDeadline, uint256 completionDeadline)
 */
async function processTaskCreated(log: any): Promise<void> {
  try {
    const { taskId, taskType, inputHash, maxBid, biddingDeadline, completionDeadline } = log.args;

    const chainTaskId = bigintToNumber(taskId);
    const taskTypeStr = TASK_TYPE_MAP[Number(taskType)] || 'CATALOG';
    const maxBidNum = weiToNumber(maxBid);

    // INSERT into tasks table
    const { error } = await supabase.from('tasks').insert({
      chain_task_id: chainTaskId,
      type: taskTypeStr,
      status: 'OPEN',
      max_bid: maxBidNum,
      input_hash: inputHash,
      bidding_deadline: new Date(bigintToNumber(biddingDeadline) * 1000).toISOString(),
      deadline: new Date(bigintToNumber(completionDeadline) * 1000).toISOString(),
      last_synced_block: bigintToNumber(log.blockNumber),
      created_at: new Date().toISOString(),
    });

    if (error && !isDuplicateError(error)) throw error;

    logEventProcessed('TaskCreated', log.blockNumber, log.transactionHash, {
      taskId: chainTaskId,
      type: taskTypeStr,
      maxBid: maxBidNum,
    });
  } catch (error) {
    logEventError('TaskCreated', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process BidSubmitted event
 * Event: BidSubmitted(uint256 indexed bidId, uint256 indexed taskId,
 *                     uint256 indexed agentId, uint256 amount)
 */
async function processBidSubmitted(log: any): Promise<void> {
  try {
    const { bidId, taskId, agentId, amount } = log.args;

    const chainBidId = bigintToNumber(bidId);
    const chainTaskId = bigintToNumber(taskId);
    const chainAgentId = bigintToNumber(agentId);
    const amountNum = weiToNumber(amount);

    // Get task UUID from chain_task_id
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('id')
      .eq('chain_task_id', chainTaskId)
      .single();

    if (taskError) throw taskError;

    // Get agent UUID and wallet from chain_agent_id
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, wallet_address')
      .eq('chain_agent_id', chainAgentId)
      .single();

    if (agentError) throw agentError;

    if (!task || !agent) {
      console.warn(`[BidSubmitted] Missing task or agent: taskId=${chainTaskId}, agentId=${chainAgentId}`);
      return;
    }

    // INSERT into bids_cache
    const { error } = await supabase.from('bids_cache').insert({
      chain_bid_id: chainBidId,
      chain_task_id: chainTaskId,
      task_id: task.id,
      agent_id: agent.id,
      bidder_wallet: agent.wallet_address.toLowerCase(),
      amount: amountNum,
      status: 'PENDING',
      last_synced_block: bigintToNumber(log.blockNumber),
      created_at: new Date().toISOString(),
    });

    if (error && !isDuplicateError(error)) throw error;

    logEventProcessed('BidSubmitted', log.blockNumber, log.transactionHash, {
      bidId: chainBidId,
      taskId: chainTaskId,
      agentId: chainAgentId,
      amount: amountNum,
    });
  } catch (error) {
    logEventError('BidSubmitted', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process BidWithdrawn event
 * Event: BidWithdrawn(uint256 indexed bidId, uint256 indexed taskId, uint256 indexed agentId)
 */
async function processBidWithdrawn(log: any): Promise<void> {
  try {
    const { bidId, taskId, agentId } = log.args;

    const chainBidId = bigintToNumber(bidId);

    // UPDATE bids_cache status to WITHDRAWN
    const { error } = await supabase
      .from('bids_cache')
      .update({
        status: 'WITHDRAWN',
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_bid_id', chainBidId);

    if (error) throw error;

    logEventProcessed('BidWithdrawn', log.blockNumber, log.transactionHash, {
      bidId: chainBidId,
      taskId: bigintToNumber(taskId),
      agentId: bigintToNumber(agentId),
    });
  } catch (error) {
    logEventError('BidWithdrawn', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process WinnerSelected event
 * Event: WinnerSelected(uint256 indexed taskId, uint256 indexed bidId,
 *                       uint256 indexed agentId, uint256 winningAmount)
 */
async function processWinnerSelected(log: any): Promise<void> {
  try {
    const { taskId, bidId, agentId, winningAmount } = log.args;

    const chainTaskId = bigintToNumber(taskId);
    const chainBidId = bigintToNumber(bidId);
    const chainAgentId = bigintToNumber(agentId);
    const winningAmountNum = weiToNumber(winningAmount);

    // Get task UUID
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('id')
      .eq('chain_task_id', chainTaskId)
      .single();

    if (taskError) throw taskError;

    // Get winning bid UUID
    const { data: winningBid, error: bidError } = await supabase
      .from('bids_cache')
      .select('id')
      .eq('chain_bid_id', chainBidId)
      .single();

    if (bidError) throw bidError;

    if (!task || !winningBid) {
      console.warn(`[WinnerSelected] Missing task or bid: taskId=${chainTaskId}, bidId=${chainBidId}`);
      return;
    }

    // UPDATE task status to ASSIGNED + set winning_bid_id
    const { error: updateTaskError } = await supabase
      .from('tasks')
      .update({
        status: 'ASSIGNED',
        winning_bid_id: winningBid.id,
        assigned_at: new Date().toISOString(),
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('id', task.id);

    if (updateTaskError) throw updateTaskError;

    // UPDATE winning bid status to WON
    const { error: updateWinningBidError } = await supabase
      .from('bids_cache')
      .update({
        status: 'WON',
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('id', winningBid.id);

    if (updateWinningBidError) throw updateWinningBidError;

    // UPDATE all other bids for this task to LOST
    const { error: updateLostBidsError } = await supabase
      .from('bids_cache')
      .update({
        status: 'LOST',
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('task_id', task.id)
      .neq('id', winningBid.id)
      .eq('status', 'PENDING');

    if (updateLostBidsError) throw updateLostBidsError;

    // Get agent wallet for economy event
    const { data: agent } = await supabase
      .from('agents')
      .select('wallet_address')
      .eq('chain_agent_id', chainAgentId)
      .single();

    // Create economy event
    if (agent) {
      await createEconomyEvent({
        event_type: 'auction_won',
        description: `Agent won task auction #${chainTaskId} with bid of ${winningAmountNum.toFixed(4)} MON`,
        agent_wallets: [agent.wallet_address],
        amount: winningAmountNum,
        tx_hash: log.transactionHash,
        block_number: bigintToNumber(log.blockNumber),
        metadata: { task_id: chainTaskId, bid_id: chainBidId },
      });
    }

    logEventProcessed('WinnerSelected', log.blockNumber, log.transactionHash, {
      taskId: chainTaskId,
      bidId: chainBidId,
      agentId: chainAgentId,
      winningAmount: winningAmountNum,
    });
  } catch (error) {
    logEventError('WinnerSelected', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process TaskCompleted event
 * Event: TaskCompleted(uint256 indexed taskId, uint256 indexed agentId, bytes32 outputHash)
 */
async function processTaskCompleted(log: any): Promise<void> {
  try {
    const { taskId, agentId, outputHash } = log.args;

    const chainTaskId = bigintToNumber(taskId);

    // UPDATE task status to COMPLETED
    const { error } = await supabase
      .from('tasks')
      .update({
        status: 'COMPLETED',
        output_hash: outputHash,
        completed_at: new Date().toISOString(),
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_task_id', chainTaskId);

    if (error) throw error;

    logEventProcessed('TaskCompleted', log.blockNumber, log.transactionHash, {
      taskId: chainTaskId,
      agentId: bigintToNumber(agentId),
    });
  } catch (error) {
    logEventError('TaskCompleted', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process TaskValidated event
 * Event: TaskValidated(uint256 indexed taskId, uint256 indexed agentId,
 *                      bool success, uint256 paymentAmount)
 */
async function processTaskValidated(log: any): Promise<void> {
  try {
    const { taskId, agentId, success, paymentAmount } = log.args;

    const chainTaskId = bigintToNumber(taskId);
    const chainAgentId = bigintToNumber(agentId);
    const paymentAmountNum = weiToNumber(paymentAmount);

    // UPDATE task status to VERIFIED or FAILED
    const newStatus = success ? 'VERIFIED' : 'FAILED';

    const { error } = await supabase
      .from('tasks')
      .update({
        status: newStatus,
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_task_id', chainTaskId);

    if (error) throw error;

    // Get agent wallet for economy event
    const { data: agent } = await supabase
      .from('agents')
      .select('wallet_address')
      .eq('chain_agent_id', chainAgentId)
      .single();

    // Create economy event
    if (agent) {
      await createEconomyEvent({
        event_type: 'task_completed',
        description: success
          ? `Task #${chainTaskId} validated successfully - Agent earned ${paymentAmountNum.toFixed(4)} MON`
          : `Task #${chainTaskId} validation failed - No payment`,
        agent_wallets: [agent.wallet_address],
        amount: success ? paymentAmountNum : 0,
        tx_hash: log.transactionHash,
        block_number: bigintToNumber(log.blockNumber),
        metadata: { task_id: chainTaskId, success },
      });
    }

    logEventProcessed('TaskValidated', log.blockNumber, log.transactionHash, {
      taskId: chainTaskId,
      agentId: chainAgentId,
      success,
      paymentAmount: paymentAmountNum,
    });
  } catch (error) {
    logEventError('TaskValidated', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process PaymentReleased event
 * Event: PaymentReleased(uint256 indexed taskId, address indexed worker, uint256 amount)
 */
async function processPaymentReleased(log: any): Promise<void> {
  try {
    const { taskId, worker, amount } = log.args;

    const chainTaskId = bigintToNumber(taskId);
    const workerAddress = worker.toLowerCase();
    const amountNum = weiToNumber(amount);

    // Create economy event
    await createEconomyEvent({
      event_type: 'task_completed',
      description: `Payment of ${amountNum.toFixed(4)} MON released for task #${chainTaskId}`,
      agent_wallets: [workerAddress],
      amount: amountNum,
      tx_hash: log.transactionHash,
      block_number: bigintToNumber(log.blockNumber),
      metadata: { task_id: chainTaskId },
    });

    logEventProcessed('PaymentReleased', log.blockNumber, log.transactionHash, {
      taskId: chainTaskId,
      worker: workerAddress,
      amount: amountNum,
    });
  } catch (error) {
    logEventError('PaymentReleased', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process TaskCancelled event
 * Event: TaskCancelled(uint256 indexed taskId)
 */
async function processTaskCancelled(log: any): Promise<void> {
  try {
    const { taskId } = log.args;

    const chainTaskId = bigintToNumber(taskId);

    // UPDATE task status to CANCELLED
    const { error } = await supabase
      .from('tasks')
      .update({
        status: 'CANCELLED',
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_task_id', chainTaskId);

    if (error) throw error;

    logEventProcessed('TaskCancelled', log.blockNumber, log.transactionHash, {
      taskId: chainTaskId,
    });
  } catch (error) {
    logEventError('TaskCancelled', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Main processor - routes events to appropriate handler
 */
export async function processTaskAuctionEvent(log: Log): Promise<void> {
  const eventName = (log as any).eventName;

  switch (eventName) {
    case 'TaskCreated':
      await processTaskCreated(log);
      break;
    case 'BidSubmitted':
      await processBidSubmitted(log);
      break;
    case 'BidWithdrawn':
      await processBidWithdrawn(log);
      break;
    case 'WinnerSelected':
      await processWinnerSelected(log);
      break;
    case 'TaskCompleted':
      await processTaskCompleted(log);
      break;
    case 'TaskValidated':
      await processTaskValidated(log);
      break;
    case 'PaymentReleased':
      await processPaymentReleased(log);
      break;
    case 'TaskCancelled':
      await processTaskCancelled(log);
      break;
    default:
      console.warn(`Unknown TaskAuction event: ${eventName}`);
  }
}
