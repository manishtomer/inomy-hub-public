/**
 * IntentAuction Event Processor
 *
 * Processes events from the IntentAuction contract
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
// INTENT_STATUS_MAP, OFFER_STATUS_MAP available if needed for enum conversions
import { createEconomyEvent, createAuctionWonEvent } from '../economy-events';

/**
 * Process IntentCreated event
 * Event: IntentCreated(uint256 indexed intentId, address indexed consumer,
 *                      bytes32 productHash, uint256 maxBudget, uint256 auctionDeadline)
 */
async function processIntentCreated(log: any): Promise<void> {
  try {
    const { intentId, consumer, productHash, maxBudget, auctionDeadline } = log.args;

    const chainIntentId = bigintToNumber(intentId);
    const maxBudgetNum = weiToNumber(maxBudget);
    const expiresAt = new Date(Number(auctionDeadline) * 1000).toISOString();

    // Insert into intents table
    const { error } = await supabase.from('intents').insert({
      chain_intent_id: chainIntentId,
      consumer_address: consumer.toLowerCase(),
      product_hash: productHash,
      max_budget: maxBudgetNum,
      status: 'OPEN',
      expires_at: expiresAt,
      last_synced_block: bigintToNumber(log.blockNumber),
    });

    if (error && !isDuplicateError(error)) throw error;

    // Create economy event
    await createEconomyEvent({
      event_type: 'investment',
      description: `New shopping intent created with max budget ${maxBudgetNum.toFixed(4)} MON`,
      agent_wallets: [],
      investor_wallet: consumer.toLowerCase(),
      amount: maxBudgetNum,
      tx_hash: log.transactionHash,
      block_number: bigintToNumber(log.blockNumber),
      metadata: { intent_id: chainIntentId },
    });

    logEventProcessed('IntentCreated', log.blockNumber, log.transactionHash, {
      intentId: chainIntentId,
      maxBudget: maxBudgetNum,
    });
  } catch (error) {
    logEventError('IntentCreated', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process OfferSubmitted event
 * Event: OfferSubmitted(uint256 indexed offerId, uint256 indexed intentId, uint256 indexed agentId,
 *                       uint256 bidFee, uint256 offerPrice, uint256 score)
 */
async function processOfferSubmitted(log: any): Promise<void> {
  try {
    const { offerId, intentId, agentId, bidFee, offerPrice, score } = log.args;

    const chainOfferId = bigintToNumber(offerId);
    const chainIntentId = bigintToNumber(intentId);
    const chainAgentId = bigintToNumber(agentId);
    const bidFeeNum = weiToNumber(bidFee);
    const offerPriceNum = weiToNumber(offerPrice);
    const scoreNum = bigintToNumber(score);

    // Get agent wallet address and intent UUID
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, wallet_address')
      .eq('chain_agent_id', chainAgentId)
      .single();

    if (agentError) throw agentError;

    const { data: intent, error: intentError } = await supabase
      .from('intents')
      .select('id')
      .eq('chain_intent_id', chainIntentId)
      .single();

    if (intentError) throw intentError;

    // Insert into offers_cache table
    const { error } = await supabase.from('offers_cache').insert({
      chain_offer_id: chainOfferId,
      chain_intent_id: chainIntentId,
      intent_id: intent.id,
      agent_id: agent.id,
      agent_wallet: agent.wallet_address,
      price: offerPriceNum,
      relevance_score: scoreNum,
      status: 'PENDING',
      last_synced_block: bigintToNumber(log.blockNumber),
    });

    if (error && !isDuplicateError(error)) throw error;

    // Create economy event
    await createEconomyEvent({
      event_type: 'auction_won',
      description: `Agent submitted offer for intent #${chainIntentId} at ${offerPriceNum.toFixed(4)} MON (bid fee: ${bidFeeNum.toFixed(4)} MON)`,
      agent_wallets: [agent.wallet_address],
      amount: bidFeeNum,
      tx_hash: log.transactionHash,
      block_number: bigintToNumber(log.blockNumber),
      metadata: {
        intent_id: chainIntentId,
        offer_id: chainOfferId,
        offer_price: offerPriceNum,
        score: scoreNum,
      },
    });

    logEventProcessed('OfferSubmitted', log.blockNumber, log.transactionHash, {
      offerId: chainOfferId,
      intentId: chainIntentId,
      agentId: chainAgentId,
      offerPrice: offerPriceNum,
    });
  } catch (error) {
    logEventError('OfferSubmitted', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process OfferWithdrawn event
 * Event: OfferWithdrawn(uint256 indexed offerId, uint256 indexed intentId, uint256 indexed agentId)
 */
async function processOfferWithdrawn(log: any): Promise<void> {
  try {
    const { offerId, intentId, agentId } = log.args;

    const chainOfferId = bigintToNumber(offerId);

    // Update offer status to WITHDRAWN
    const { error } = await supabase
      .from('offers_cache')
      .update({
        status: 'WITHDRAWN',
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_offer_id', chainOfferId);

    if (error) throw error;

    logEventProcessed('OfferWithdrawn', log.blockNumber, log.transactionHash, {
      offerId: chainOfferId,
      intentId: bigintToNumber(intentId),
      agentId: bigintToNumber(agentId),
    });
  } catch (error) {
    logEventError('OfferWithdrawn', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process AuctionClosed event
 * Event: AuctionClosed(uint256 indexed intentId, uint256 indexed winningOfferId,
 *                      uint256 indexed winningAgentId, uint256 winningOfferPrice, uint256 totalFeesCollected)
 */
async function processAuctionClosed(log: any): Promise<void> {
  try {
    const { intentId, winningOfferId, winningAgentId, winningOfferPrice, totalFeesCollected } =
      log.args;

    const chainIntentId = bigintToNumber(intentId);
    const chainWinningOfferId = bigintToNumber(winningOfferId);
    const chainWinningAgentId = bigintToNumber(winningAgentId);
    const winningPriceNum = weiToNumber(winningOfferPrice);
    const totalFeesNum = weiToNumber(totalFeesCollected);

    // Get winning offer UUID and agent wallet
    const { data: winningOffer, error: offerError } = await supabase
      .from('offers_cache')
      .select('id')
      .eq('chain_offer_id', chainWinningOfferId)
      .single();

    if (offerError) throw offerError;

    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('wallet_address')
      .eq('chain_agent_id', chainWinningAgentId)
      .single();

    if (agentError) throw agentError;

    // Update intent status to MATCHED and set accepted_offer_id
    const { error: intentError } = await supabase
      .from('intents')
      .update({
        status: 'MATCHED',
        accepted_offer_id: winningOffer.id,
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_intent_id', chainIntentId);

    if (intentError) throw intentError;

    // Update winning offer status to ACCEPTED (WON -> ACCEPTED per DB mapping)
    await supabase
      .from('offers_cache')
      .update({
        status: 'ACCEPTED',
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_offer_id', chainWinningOfferId);

    // Update all other PENDING offers to REJECTED (LOST -> REJECTED per DB mapping)
    await supabase
      .from('offers_cache')
      .update({
        status: 'REJECTED',
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_intent_id', chainIntentId)
      .eq('status', 'PENDING')
      .neq('chain_offer_id', chainWinningOfferId);

    // Create auction won event
    await createAuctionWonEvent(
      agent.wallet_address,
      'intent',
      chainIntentId,
      winningPriceNum,
      log.transactionHash,
      bigintToNumber(log.blockNumber)
    );

    // Create general economy event for fees collected
    await createEconomyEvent({
      event_type: 'dividend_paid',
      description: `Intent auction #${chainIntentId} closed - ${totalFeesNum.toFixed(4)} MON in fees collected`,
      agent_wallets: [agent.wallet_address],
      amount: totalFeesNum,
      tx_hash: log.transactionHash,
      block_number: bigintToNumber(log.blockNumber),
      metadata: {
        intent_id: chainIntentId,
        winning_offer_id: chainWinningOfferId,
        winning_price: winningPriceNum,
      },
    });

    logEventProcessed('AuctionClosed', log.blockNumber, log.transactionHash, {
      intentId: chainIntentId,
      winningOfferId: chainWinningOfferId,
      winningAgentId: chainWinningAgentId,
      winningPrice: winningPriceNum,
    });
  } catch (error) {
    logEventError('AuctionClosed', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process IntentCancelled event
 * Event: IntentCancelled(uint256 indexed intentId)
 */
async function processIntentCancelled(log: any): Promise<void> {
  try {
    const { intentId } = log.args;

    const chainIntentId = bigintToNumber(intentId);

    // Update intent status to EXPIRED (CANCELLED -> EXPIRED per contract)
    const { error } = await supabase
      .from('intents')
      .update({
        status: 'EXPIRED',
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_intent_id', chainIntentId);

    if (error) throw error;

    // Create economy event
    await createEconomyEvent({
      event_type: 'policy_change',
      description: `Intent #${chainIntentId} cancelled`,
      tx_hash: log.transactionHash,
      block_number: bigintToNumber(log.blockNumber),
      metadata: { intent_id: chainIntentId },
    });

    logEventProcessed('IntentCancelled', log.blockNumber, log.transactionHash, {
      intentId: chainIntentId,
    });
  } catch (error) {
    logEventError('IntentCancelled', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process IntentFulfilled event
 * Event: IntentFulfilled(uint256 indexed intentId, uint256 indexed agentId)
 */
async function processIntentFulfilled(log: any): Promise<void> {
  try {
    const { intentId, agentId } = log.args;

    const chainIntentId = bigintToNumber(intentId);
    const chainAgentId = bigintToNumber(agentId);

    // Get agent wallet for economy event
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('wallet_address')
      .eq('chain_agent_id', chainAgentId)
      .single();

    if (agentError) throw agentError;

    // Update intent status to FULFILLED
    const { error } = await supabase
      .from('intents')
      .update({
        status: 'FULFILLED',
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_intent_id', chainIntentId);

    if (error) throw error;

    // Create economy event
    await createEconomyEvent({
      event_type: 'task_completed',
      description: `Intent #${chainIntentId} fulfilled by agent`,
      agent_wallets: [agent.wallet_address],
      tx_hash: log.transactionHash,
      block_number: bigintToNumber(log.blockNumber),
      metadata: { intent_id: chainIntentId, agent_id: chainAgentId },
    });

    logEventProcessed('IntentFulfilled', log.blockNumber, log.transactionHash, {
      intentId: chainIntentId,
      agentId: chainAgentId,
    });
  } catch (error) {
    logEventError('IntentFulfilled', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process IntentDisputed event
 * Event: IntentDisputed(uint256 indexed intentId, string reason)
 */
async function processIntentDisputed(log: any): Promise<void> {
  try {
    const { intentId, reason } = log.args;

    const chainIntentId = bigintToNumber(intentId);

    // Update intent status to DISPUTED
    const { error } = await supabase
      .from('intents')
      .update({
        status: 'DISPUTED',
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_intent_id', chainIntentId);

    if (error) throw error;

    // Create economy event
    await createEconomyEvent({
      event_type: 'policy_change',
      description: `Intent #${chainIntentId} disputed: ${reason}`,
      tx_hash: log.transactionHash,
      block_number: bigintToNumber(log.blockNumber),
      metadata: { intent_id: chainIntentId, reason },
    });

    logEventProcessed('IntentDisputed', log.blockNumber, log.transactionHash, {
      intentId: chainIntentId,
      reason,
    });
  } catch (error) {
    logEventError('IntentDisputed', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Main processor - routes events to appropriate handler
 */
export async function processIntentAuctionEvent(log: Log): Promise<void> {
  const eventName = (log as any).eventName;

  switch (eventName) {
    case 'IntentCreated':
      await processIntentCreated(log);
      break;
    case 'OfferSubmitted':
      await processOfferSubmitted(log);
      break;
    case 'OfferWithdrawn':
      await processOfferWithdrawn(log);
      break;
    case 'AuctionClosed':
      await processAuctionClosed(log);
      break;
    case 'IntentCancelled':
      await processIntentCancelled(log);
      break;
    case 'IntentFulfilled':
      await processIntentFulfilled(log);
      break;
    case 'IntentDisputed':
      await processIntentDisputed(log);
      break;
    default:
      console.warn(`Unknown IntentAuction event: ${eventName}`);
  }
}
