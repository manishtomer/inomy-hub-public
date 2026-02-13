/**
 * Partnership Event Processor
 *
 * Processes events from the Partnership contract
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
// PARTNERSHIP_STATUS_MAP, PROPOSAL_STATUS_MAP available if needed for enum conversions
import { createEconomyEvent, createPartnershipEvent } from '../economy-events';

/**
 * Process ProposalCreated event
 * Event: ProposalCreated(uint256 indexed proposalId, uint256 indexed initiatorAgentId,
 *                        uint256 indexed targetAgentId, uint256 initiatorSplit,
 *                        uint256 targetSplit, uint256 expiresAt)
 */
async function processProposalCreated(log: any): Promise<void> {
  try {
    const { proposalId, initiatorAgentId, targetAgentId, initiatorSplit, targetSplit, expiresAt } =
      log.args;

    const chainProposalId = bigintToNumber(proposalId);

    // Get agent info for wallet addresses
    const { data: initiatorAgent } = await supabase
      .from('agents')
      .select('id, wallet_address')
      .eq('chain_agent_id', bigintToNumber(initiatorAgentId))
      .single();

    const { data: targetAgent } = await supabase
      .from('agents')
      .select('id, wallet_address')
      .eq('chain_agent_id', bigintToNumber(targetAgentId))
      .single();

    if (!initiatorAgent || !targetAgent) {
      console.warn(
        `[ProposalCreated] Missing agent data: initiator=${bigintToNumber(initiatorAgentId)}, target=${bigintToNumber(targetAgentId)}`
      );
      return;
    }

    // INSERT into partnerships_cache with status PROPOSED
    const { error } = await supabase.from('partnerships_cache').insert({
      chain_proposal_id: chainProposalId,
      chain_partnership_id: null,
      agent1_id: initiatorAgent.id,
      agent2_id: targetAgent.id,
      agent1_chain_id: bigintToNumber(initiatorAgentId),
      agent2_chain_id: bigintToNumber(targetAgentId),
      agent1_split: bigintToNumber(initiatorSplit),
      agent2_split: bigintToNumber(targetSplit),
      status: 'PROPOSED',
      total_revenue: 0,
      balance: 0,
      expires_at: new Date(bigintToNumber(expiresAt) * 1000).toISOString(),
      last_synced_block: bigintToNumber(log.blockNumber),
    });

    if (error && !isDuplicateError(error)) throw error;

    // Create economy event
    await createEconomyEvent({
      event_type: 'partnership',
      description: `Partnership proposal #${chainProposalId} created (${bigintToNumber(initiatorSplit)}/${bigintToNumber(targetSplit)} split)`,
      agent_wallets: [initiatorAgent.wallet_address, targetAgent.wallet_address],
      tx_hash: log.transactionHash,
      block_number: bigintToNumber(log.blockNumber),
      metadata: {
        proposal_id: chainProposalId,
        initiator_split: bigintToNumber(initiatorSplit),
        target_split: bigintToNumber(targetSplit),
      },
    });

    logEventProcessed('ProposalCreated', log.blockNumber, log.transactionHash, {
      proposalId: chainProposalId,
      initiator: bigintToNumber(initiatorAgentId),
      target: bigintToNumber(targetAgentId),
    });
  } catch (error) {
    logEventError('ProposalCreated', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process ProposalAccepted event
 * Event: ProposalAccepted(uint256 indexed proposalId, uint256 indexed partnershipId)
 */
async function processProposalAccepted(log: any): Promise<void> {
  try {
    const { proposalId, partnershipId } = log.args;

    // UPDATE partnerships_cache status to ACTIVE and add partnershipId
    const { error } = await supabase
      .from('partnerships_cache')
      .update({
        chain_partnership_id: bigintToNumber(partnershipId),
        status: 'ACTIVE',
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_proposal_id', bigintToNumber(proposalId));

    if (error) throw error;

    logEventProcessed('ProposalAccepted', log.blockNumber, log.transactionHash, {
      proposalId: bigintToNumber(proposalId),
      partnershipId: bigintToNumber(partnershipId),
    });
  } catch (error) {
    logEventError('ProposalAccepted', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process ProposalRejected event
 * Event: ProposalRejected(uint256 indexed proposalId)
 */
async function processProposalRejected(log: any): Promise<void> {
  try {
    const { proposalId } = log.args;

    // UPDATE partnerships_cache status to REJECTED
    const { error } = await supabase
      .from('partnerships_cache')
      .update({
        status: 'REJECTED',
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_proposal_id', bigintToNumber(proposalId));

    if (error) throw error;

    logEventProcessed('ProposalRejected', log.blockNumber, log.transactionHash, {
      proposalId: bigintToNumber(proposalId),
    });
  } catch (error) {
    logEventError('ProposalRejected', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process CounterOfferCreated event
 * Event: CounterOfferCreated(uint256 indexed originalProposalId, uint256 indexed counterProposalId,
 *                            uint256 newInitiatorSplit, uint256 newTargetSplit)
 */
async function processCounterOfferCreated(log: any): Promise<void> {
  try {
    const { originalProposalId, counterProposalId, newInitiatorSplit, newTargetSplit } = log.args;

    // UPDATE original proposal status to NEGOTIATING
    const { error: updateError } = await supabase
      .from('partnerships_cache')
      .update({
        status: 'NEGOTIATING',
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_proposal_id', bigintToNumber(originalProposalId));

    if (updateError) throw updateError;

    // Get original proposal data to get agent IDs (reversed for counter-offer)
    const { data: originalProposal } = await supabase
      .from('partnerships_cache')
      .select('agent1_id, agent2_id, agent1_chain_id, agent2_chain_id')
      .eq('chain_proposal_id', bigintToNumber(originalProposalId))
      .single();

    if (originalProposal) {
      // INSERT counter-proposal (agent roles are reversed)
      const { error: insertError } = await supabase.from('partnerships_cache').insert({
        chain_proposal_id: bigintToNumber(counterProposalId),
        chain_partnership_id: null,
        agent1_id: originalProposal.agent2_id, // Target becomes initiator
        agent2_id: originalProposal.agent1_id, // Initiator becomes target
        agent1_chain_id: originalProposal.agent2_chain_id,
        agent2_chain_id: originalProposal.agent1_chain_id,
        agent1_split: bigintToNumber(newTargetSplit), // Counter-offerer's split
        agent2_split: bigintToNumber(newInitiatorSplit), // Original initiator's split
        status: 'PROPOSED',
        total_revenue: 0,
        balance: 0,
        last_synced_block: bigintToNumber(log.blockNumber),
      });

      if (insertError && !isDuplicateError(insertError)) throw insertError;
    }

    logEventProcessed('CounterOfferCreated', log.blockNumber, log.transactionHash, {
      originalProposalId: bigintToNumber(originalProposalId),
      counterProposalId: bigintToNumber(counterProposalId),
    });
  } catch (error) {
    logEventError('CounterOfferCreated', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process PartnershipCreated event
 * Event: PartnershipCreated(uint256 indexed partnershipId, uint256 indexed agent1Id,
 *                          uint256 indexed agent2Id, uint256 agent1Split, uint256 agent2Split)
 */
async function processPartnershipCreated(log: any): Promise<void> {
  try {
    const { partnershipId, agent1Id, agent2Id, agent1Split, agent2Split } = log.args;

    const chainPartnershipId = bigintToNumber(partnershipId);

    // Get agent info
    const { data: agent1 } = await supabase
      .from('agents')
      .select('id, wallet_address')
      .eq('chain_agent_id', bigintToNumber(agent1Id))
      .single();

    const { data: agent2 } = await supabase
      .from('agents')
      .select('id, wallet_address')
      .eq('chain_agent_id', bigintToNumber(agent2Id))
      .single();

    if (!agent1 || !agent2) {
      console.warn(
        `[PartnershipCreated] Missing agent data: agent1=${bigintToNumber(agent1Id)}, agent2=${bigintToNumber(agent2Id)}`
      );
      return;
    }

    // UPSERT partnerships_cache ACTIVE
    const { error } = await supabase
      .from('partnerships_cache')
      .upsert(
        {
          chain_partnership_id: chainPartnershipId,
          agent1_id: agent1.id,
          agent2_id: agent2.id,
          agent1_chain_id: bigintToNumber(agent1Id),
          agent2_chain_id: bigintToNumber(agent2Id),
          agent1_split: bigintToNumber(agent1Split),
          agent2_split: bigintToNumber(agent2Split),
          status: 'ACTIVE',
          total_revenue: 0,
          balance: 0,
          last_synced_block: bigintToNumber(log.blockNumber),
        },
        { onConflict: 'chain_partnership_id' }
      );

    if (error) throw error;

    // Create partnership economy event
    await createPartnershipEvent(
      agent1.wallet_address,
      agent2.wallet_address,
      chainPartnershipId,
      log.transactionHash,
      bigintToNumber(log.blockNumber)
    );

    logEventProcessed('PartnershipCreated', log.blockNumber, log.transactionHash, {
      partnershipId: chainPartnershipId,
      agent1: bigintToNumber(agent1Id),
      agent2: bigintToNumber(agent2Id),
    });
  } catch (error) {
    logEventError('PartnershipCreated', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process PartnershipDissolved event
 * Event: PartnershipDissolved(uint256 indexed partnershipId)
 */
async function processPartnershipDissolved(log: any): Promise<void> {
  try {
    const { partnershipId } = log.args;

    // UPDATE partnerships_cache status to DISSOLVED
    const { error } = await supabase
      .from('partnerships_cache')
      .update({
        status: 'DISSOLVED',
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_partnership_id', bigintToNumber(partnershipId));

    if (error) throw error;

    logEventProcessed('PartnershipDissolved', log.blockNumber, log.transactionHash, {
      partnershipId: bigintToNumber(partnershipId),
    });
  } catch (error) {
    logEventError('PartnershipDissolved', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process RevenueReceived event
 * Event: RevenueReceived(uint256 indexed partnershipId, uint256 amount, uint256 newTotalRevenue)
 */
async function processRevenueReceived(log: any): Promise<void> {
  try {
    const { partnershipId, amount, newTotalRevenue } = log.args;

    const revenueAmount = weiToNumber(amount);
    const totalRevenue = weiToNumber(newTotalRevenue);

    // UPDATE partnerships_cache total_revenue
    const { error } = await supabase
      .from('partnerships_cache')
      .update({
        total_revenue: totalRevenue,
        balance: totalRevenue, // Update balance too
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_partnership_id', bigintToNumber(partnershipId));

    if (error) throw error;

    // Get partnership data for economy event
    const { data: partnership } = await supabase
      .from('partnerships_cache')
      .select('agent1_id, agent2_id')
      .eq('chain_partnership_id', bigintToNumber(partnershipId))
      .single();

    if (partnership) {
      // Get agent wallet addresses
      const { data: agents } = await supabase
        .from('agents')
        .select('wallet_address')
        .in('id', [partnership.agent1_id, partnership.agent2_id]);

      if (agents && agents.length === 2) {
        await createEconomyEvent({
          event_type: 'partnership',
          description: `Partnership #${bigintToNumber(partnershipId)} received ${revenueAmount.toFixed(4)} MON`,
          agent_wallets: agents.map((a) => a.wallet_address),
          amount: revenueAmount,
          tx_hash: log.transactionHash,
          block_number: bigintToNumber(log.blockNumber),
          metadata: {
            partnership_id: bigintToNumber(partnershipId),
            total_revenue: totalRevenue,
          },
        });
      }
    }

    logEventProcessed('RevenueReceived', log.blockNumber, log.transactionHash, {
      partnershipId: bigintToNumber(partnershipId),
      amount: revenueAmount,
    });
  } catch (error) {
    logEventError('RevenueReceived', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process FundsWithdrawn event
 * Event: FundsWithdrawn(uint256 indexed partnershipId, uint256 indexed agentId, uint256 amount)
 */
async function processFundsWithdrawn(log: any): Promise<void> {
  try {
    const { partnershipId, agentId, amount } = log.args;

    const withdrawAmount = weiToNumber(amount);

    // Get current partnership data
    const { data: partnership, error: fetchError } = await supabase
      .from('partnerships_cache')
      .select('balance')
      .eq('chain_partnership_id', bigintToNumber(partnershipId))
      .single();

    if (fetchError) throw fetchError;

    // UPDATE partnerships_cache balance (subtract withdrawn amount)
    const newBalance = partnership.balance - withdrawAmount;

    const { error } = await supabase
      .from('partnerships_cache')
      .update({
        balance: Math.max(0, newBalance), // Ensure non-negative
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_partnership_id', bigintToNumber(partnershipId));

    if (error) throw error;

    logEventProcessed('FundsWithdrawn', log.blockNumber, log.transactionHash, {
      partnershipId: bigintToNumber(partnershipId),
      agentId: bigintToNumber(agentId),
      amount: withdrawAmount,
    });
  } catch (error) {
    logEventError('FundsWithdrawn', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Main processor - routes events to appropriate handler
 */
export async function processPartnershipEvent(log: Log): Promise<void> {
  const eventName = (log as any).eventName;

  switch (eventName) {
    case 'ProposalCreated':
      await processProposalCreated(log);
      break;
    case 'ProposalAccepted':
      await processProposalAccepted(log);
      break;
    case 'ProposalRejected':
      await processProposalRejected(log);
      break;
    case 'CounterOfferCreated':
      await processCounterOfferCreated(log);
      break;
    case 'PartnershipCreated':
      await processPartnershipCreated(log);
      break;
    case 'PartnershipDissolved':
      await processPartnershipDissolved(log);
      break;
    case 'RevenueReceived':
      await processRevenueReceived(log);
      break;
    case 'FundsWithdrawn':
      await processFundsWithdrawn(log);
      break;
    default:
      console.warn(`Unknown Partnership event: ${eventName}`);
  }
}
