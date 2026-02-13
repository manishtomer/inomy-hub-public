/**
 * Economy Events Helper
 *
 * Creates economy event records in the database from blockchain events
 */

import { supabase } from '../supabase';
import { isDuplicateError, logEventError } from './event-processor';

export interface CreateEconomyEventParams {
  event_type:
    | 'task_completed'
    | 'investment'
    | 'partnership'
    | 'agent_death'
    | 'auction_won'
    | 'policy_change'
    | 'dividend_paid'
    | 'token_bought'
    | 'token_sold'
    | 'reputation_changed'
    | 'task_assigned'
    | 'task_payment'
    | 'cost_sink_payment'
    | 'x402_payment'
    | 'living_cost'
    | 'bid_placed'
    | 'brain_decision';
  description: string;
  agent_wallets?: string[];
  investor_wallet?: string | null;
  amount?: number | null;
  tx_hash?: string | null;
  block_number?: number | null;
  round_number?: number | null;
  metadata?: Record<string, unknown>;
}

/**
 * Create an economy event record
 * Uses tx_hash + block_number for deduplication
 */
export async function createEconomyEvent(params: CreateEconomyEventParams): Promise<void> {
  try {
    const { error } = await supabase.from('economy_events').insert({
      event_type: params.event_type,
      description: params.description,
      agent_wallets: params.agent_wallets || [],
      investor_wallet: params.investor_wallet || null,
      amount: params.amount || null,
      tx_hash: params.tx_hash || null,
      block_number: params.block_number || null,
      round_number: params.round_number || null,
      metadata: params.metadata || {},
      created_at: new Date().toISOString(),
    });

    if (error) {
      // Ignore duplicate errors (already processed this event)
      if (isDuplicateError(error)) {
        console.log(
          `[economy_events] Duplicate event skipped: ${params.event_type} | ${params.tx_hash}`
        );
        return;
      }

      throw error;
    }

    console.log(`[economy_events] Created: ${params.event_type} | ${params.description}`);
  } catch (error) {
    logEventError('economy_events', error as Error, undefined, params.tx_hash || undefined);
    // Don't throw - we don't want to fail sync if economy event creation fails
  }
}

/**
 * Create a task completed economy event
 */
export async function createTaskCompletedEvent(
  agentWallet: string,
  taskId: number,
  revenue: number,
  txHash: string,
  blockNumber: number
): Promise<void> {
  await createEconomyEvent({
    event_type: 'task_completed',
    description: `Agent completed task #${taskId} and earned ${revenue.toFixed(4)} MON`,
    agent_wallets: [agentWallet],
    amount: revenue,
    tx_hash: txHash,
    block_number: blockNumber,
    metadata: { task_id: taskId },
  });
}

/**
 * Create a token bought economy event
 */
export async function createTokenBoughtEvent(
  investorWallet: string,
  agentWallet: string,
  tokenAmount: number,
  monAmount: number,
  txHash: string,
  blockNumber: number
): Promise<void> {
  await createEconomyEvent({
    event_type: 'token_bought',
    description: `Investor bought ${tokenAmount.toFixed(2)} tokens for ${monAmount.toFixed(4)} MON`,
    agent_wallets: [agentWallet],
    investor_wallet: investorWallet,
    amount: monAmount,
    tx_hash: txHash,
    block_number: blockNumber,
    metadata: { token_amount: tokenAmount },
  });
}

/**
 * Create a token sold economy event
 */
export async function createTokenSoldEvent(
  investorWallet: string,
  agentWallet: string,
  tokenAmount: number,
  monAmount: number,
  txHash: string,
  blockNumber: number
): Promise<void> {
  await createEconomyEvent({
    event_type: 'token_sold',
    description: `Investor sold ${tokenAmount.toFixed(2)} tokens for ${monAmount.toFixed(4)} MON`,
    agent_wallets: [agentWallet],
    investor_wallet: investorWallet,
    amount: monAmount,
    tx_hash: txHash,
    block_number: blockNumber,
    metadata: { token_amount: tokenAmount },
  });
}

/**
 * Create a dividend paid economy event
 */
export async function createDividendPaidEvent(
  agentWallet: string,
  totalAmount: number,
  investorShare: number,
  txHash: string,
  blockNumber: number
): Promise<void> {
  await createEconomyEvent({
    event_type: 'dividend_paid',
    description: `Agent deposited ${totalAmount.toFixed(4)} MON in profits (${investorShare.toFixed(4)} MON to investors)`,
    agent_wallets: [agentWallet],
    amount: totalAmount,
    tx_hash: txHash,
    block_number: blockNumber,
    metadata: { investor_share: investorShare },
  });
}

/**
 * Create a reputation changed economy event
 */
export async function createReputationChangedEvent(
  agentWallet: string,
  oldReputation: number,
  newReputation: number,
  txHash: string,
  blockNumber: number
): Promise<void> {
  const change = newReputation - oldReputation;
  const direction = change > 0 ? 'increased' : 'decreased';

  await createEconomyEvent({
    event_type: 'reputation_changed',
    description: `Agent reputation ${direction} from ${(oldReputation / 100).toFixed(1)} to ${(newReputation / 100).toFixed(1)}`,
    agent_wallets: [agentWallet],
    tx_hash: txHash,
    block_number: blockNumber,
    metadata: { old_reputation: oldReputation, new_reputation: newReputation, change },
  });
}

/**
 * Create a partnership economy event
 */
export async function createPartnershipEvent(
  agent1Wallet: string,
  agent2Wallet: string,
  partnershipId: number,
  txHash: string,
  blockNumber: number
): Promise<void> {
  await createEconomyEvent({
    event_type: 'partnership',
    description: `Agents formed partnership #${partnershipId}`,
    agent_wallets: [agent1Wallet, agent2Wallet],
    tx_hash: txHash,
    block_number: blockNumber,
    metadata: { partnership_id: partnershipId },
  });
}

/**
 * Create an auction won economy event
 */
export async function createAuctionWonEvent(
  agentWallet: string,
  auctionType: 'task' | 'intent',
  auctionId: number,
  amount: number,
  txHash: string,
  blockNumber: number
): Promise<void> {
  await createEconomyEvent({
    event_type: 'auction_won',
    description: `Agent won ${auctionType} auction #${auctionId} with bid of ${amount.toFixed(4)} MON`,
    agent_wallets: [agentWallet],
    amount,
    tx_hash: txHash,
    block_number: blockNumber,
    metadata: { auction_type: auctionType, auction_id: auctionId },
  });
}

/**
 * Create a bid placed economy event
 * Used by both simulation and real bidding
 */
export async function createBidPlacedEvent(
  agentWallet: string,
  agentName: string,
  taskType: string,
  bidAmount: number,
  taskId: string,
  metadata?: {
    margin?: number;
    policy_source?: string;
  }
): Promise<void> {
  await createEconomyEvent({
    event_type: 'bid_placed',
    description: `${agentName} bid $${bidAmount.toFixed(4)} on ${taskType} task`,
    agent_wallets: [agentWallet],
    amount: bidAmount,
    metadata: {
      task_type: taskType,
      task_id: taskId,
      agent_name: agentName,
      ...metadata,
    },
  });
}

/**
 * Create a brain decision economy event
 * Records when an agent's brain makes a strategic decision
 */
export async function createBrainDecisionEvent(
  agentWallet: string,
  agentName: string,
  decisionType: 'policy_update' | 'partnership_proposal' | 'partnership_ended' | 'exception_handled',
  reasoning: string,
  metadata?: {
    trigger?: string;
    old_margin?: number;
    new_margin?: number;
    partner_name?: string;
    [key: string]: unknown;
  }
): Promise<void> {
  // Truncate reasoning to first ~100 chars for the one-liner
  const shortReasoning = reasoning.length > 100
    ? reasoning.substring(0, 100) + '...'
    : reasoning;

  await createEconomyEvent({
    event_type: 'brain_decision',
    description: `${agentName}: "${shortReasoning}"`,
    agent_wallets: [agentWallet],
    metadata: {
      decision_type: decisionType,
      agent_name: agentName,
      full_reasoning: reasoning,
      ...metadata,
    },
  });
}
