/**
 * AgentRegistry Event Processor
 *
 * Processes events from the AgentRegistry contract
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
import { AGENT_TYPE_MAP, AGENT_STATUS_MAP } from '../config';
import {
  createEconomyEvent,
  createReputationChangedEvent,
  createTaskCompletedEvent,
} from '../economy-events';

/**
 * Process AgentRegistered event
 * Event: AgentRegistered(uint256 indexed agentId, address indexed creator, address indexed walletAddress,
 *                         address tokenAddress, string name, uint8 agentType, uint256 creatorAllocation)
 */
async function processAgentRegistered(log: any): Promise<void> {
  try {
    const { agentId, creator, walletAddress, tokenAddress, name, agentType, creatorAllocation } =
      log.args;

    const chainAgentId = bigintToNumber(agentId);
    const agentTypeStr = AGENT_TYPE_MAP[Number(agentType)] || 'CATALOG';

    // UPSERT into agents table
    const { data: existingAgent } = await supabase
      .from('agents')
      .select('id')
      .eq('chain_agent_id', chainAgentId)
      .single();

    if (existingAgent) {
      // Update existing agent
      const { error } = await supabase
        .from('agents')
        .update({
          owner_wallet: creator.toLowerCase(),
          wallet_address: walletAddress.toLowerCase(),
          token_address: tokenAddress.toLowerCase(),
          name,
          type: agentTypeStr,
          status: 'UNFUNDED',
          last_synced_block: bigintToNumber(log.blockNumber),
        })
        .eq('id', existingAgent.id);

      if (error) throw error;

      // INSERT into agent_token_addresses
      await supabase
        .from('agent_token_addresses')
        .upsert(
          {
            agent_id: existingAgent.id,
            chain_agent_id: chainAgentId,
            token_address: tokenAddress.toLowerCase(),
            created_at_block: bigintToNumber(log.blockNumber),
          },
          { onConflict: 'token_address' }
        );
    } else {
      // Insert new agent
      const { data: newAgent, error } = await supabase
        .from('agents')
        .insert({
          chain_agent_id: chainAgentId,
          name,
          type: agentTypeStr,
          status: 'UNFUNDED',
          owner_wallet: creator.toLowerCase(),
          wallet_address: walletAddress.toLowerCase(),
          token_address: tokenAddress.toLowerCase(),
          reputation: 500, // INITIAL_REPUTATION from contract
          balance: 0,
          token_price: 0.001, // BASE_PRICE from contract
          tasks_completed: 0,
          tasks_failed: 0,
          total_revenue: 0,
          investor_share_bps: 7500, // Default 75%
          last_synced_block: bigintToNumber(log.blockNumber),
        })
        .select('id')
        .single();

      if (error && !isDuplicateError(error)) throw error;

      if (newAgent) {
        // INSERT into agent_token_addresses
        await supabase.from('agent_token_addresses').insert({
          agent_id: newAgent.id,
          chain_agent_id: chainAgentId,
          token_address: tokenAddress.toLowerCase(),
          created_at_block: bigintToNumber(log.blockNumber),
        });
      }
    }

    // Create economy event
    await createEconomyEvent({
      event_type: 'investment',
      description: `New agent "${name}" (${agentTypeStr}) registered`,
      agent_wallets: [walletAddress.toLowerCase()],
      tx_hash: log.transactionHash,
      block_number: bigintToNumber(log.blockNumber),
      metadata: { agent_id: chainAgentId, creator_allocation: bigintToNumber(creatorAllocation) },
    });

    logEventProcessed('AgentRegistered', log.blockNumber, log.transactionHash, {
      agentId: chainAgentId,
      name,
    });
  } catch (error) {
    logEventError('AgentRegistered', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process AgentStatusChanged event
 */
async function processAgentStatusChanged(log: any): Promise<void> {
  try {
    const { agentId, newStatus } = log.args;

    const newStatusStr = AGENT_STATUS_MAP[Number(newStatus)] || 'UNFUNDED';

    const { error } = await supabase
      .from('agents')
      .update({
        status: newStatusStr,
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_agent_id', bigintToNumber(agentId));

    if (error) throw error;

    logEventProcessed('AgentStatusChanged', log.blockNumber, log.transactionHash, {
      agentId: bigintToNumber(agentId),
      newStatus: newStatusStr,
    });
  } catch (error) {
    logEventError('AgentStatusChanged', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process ReputationUpdated event
 */
async function processReputationUpdated(log: any): Promise<void> {
  try {
    const { agentId, oldReputation, newReputation } = log.args;

    const { data: agent, error: fetchError } = await supabase
      .from('agents')
      .select('wallet_address')
      .eq('chain_agent_id', bigintToNumber(agentId))
      .single();

    if (fetchError) throw fetchError;

    const { error } = await supabase
      .from('agents')
      .update({
        reputation: bigintToNumber(newReputation),
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_agent_id', bigintToNumber(agentId));

    if (error) throw error;

    // Create reputation history entry
    await supabase.from('reputation_history').insert({
      agent_wallet: agent.wallet_address,
      old_reputation: bigintToNumber(oldReputation),
      new_reputation: bigintToNumber(newReputation),
      change_amount: bigintToNumber(newReputation) - bigintToNumber(oldReputation),
      tx_hash: log.transactionHash,
      block_number: bigintToNumber(log.blockNumber),
      changed_at: new Date().toISOString(),
    });

    // Create economy event
    if (agent) {
      await createReputationChangedEvent(
        agent.wallet_address,
        bigintToNumber(oldReputation),
        bigintToNumber(newReputation),
        log.transactionHash,
        bigintToNumber(log.blockNumber)
      );
    }

    logEventProcessed('ReputationUpdated', log.blockNumber, log.transactionHash, {
      agentId: bigintToNumber(agentId),
      newReputation: bigintToNumber(newReputation),
    });
  } catch (error) {
    logEventError('ReputationUpdated', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process TaskCompleted event (from AgentRegistry)
 */
async function processTaskCompleted(log: any): Promise<void> {
  try {
    const { agentId, revenue, totalCompleted } = log.args;

    const { data: agent, error: fetchError } = await supabase
      .from('agents')
      .select('wallet_address, total_revenue')
      .eq('chain_agent_id', bigintToNumber(agentId))
      .single();

    if (fetchError) throw fetchError;

    const revenueNum = weiToNumber(revenue);

    const { error } = await supabase
      .from('agents')
      .update({
        tasks_completed: bigintToNumber(totalCompleted),
        total_revenue: agent.total_revenue + revenueNum,
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_agent_id', bigintToNumber(agentId));

    if (error) throw error;

    // Create economy event
    if (agent) {
      await createTaskCompletedEvent(
        agent.wallet_address,
        0, // We don't have task ID here
        revenueNum,
        log.transactionHash,
        bigintToNumber(log.blockNumber)
      );
    }

    logEventProcessed('TaskCompleted', log.blockNumber, log.transactionHash, {
      agentId: bigintToNumber(agentId),
      revenue: revenueNum,
    });
  } catch (error) {
    logEventError('TaskCompleted', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process TaskFailed event
 */
async function processTaskFailed(log: any): Promise<void> {
  try {
    const { agentId, totalFailed } = log.args;

    const { error } = await supabase
      .from('agents')
      .update({
        tasks_failed: bigintToNumber(totalFailed),
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_agent_id', bigintToNumber(agentId));

    if (error) throw error;

    logEventProcessed('TaskFailed', log.blockNumber, log.transactionHash, {
      agentId: bigintToNumber(agentId),
      totalFailed: bigintToNumber(totalFailed),
    });
  } catch (error) {
    logEventError('TaskFailed', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process AgentWalletUpdated event
 */
async function processAgentWalletUpdated(log: any): Promise<void> {
  try {
    const { agentId, newWallet } = log.args;

    const { error } = await supabase
      .from('agents')
      .update({
        wallet_address: newWallet.toLowerCase(),
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_agent_id', bigintToNumber(agentId));

    if (error) throw error;

    logEventProcessed('AgentWalletUpdated', log.blockNumber, log.transactionHash, {
      agentId: bigintToNumber(agentId),
      newWallet,
    });
  } catch (error) {
    logEventError('AgentWalletUpdated', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Process AgentMetadataUpdated event
 */
async function processAgentMetadataUpdated(log: any): Promise<void> {
  try {
    const { agentId, newMetadataURI } = log.args;

    const { error } = await supabase
      .from('agents')
      .update({
        metadata_uri: newMetadataURI,
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('chain_agent_id', bigintToNumber(agentId));

    if (error) throw error;

    logEventProcessed('AgentMetadataUpdated', log.blockNumber, log.transactionHash, {
      agentId: bigintToNumber(agentId),
    });
  } catch (error) {
    logEventError('AgentMetadataUpdated', error as Error, log.blockNumber, log.transactionHash);
    throw error;
  }
}

/**
 * Main processor - routes events to appropriate handler
 */
export async function processAgentRegistryEvent(log: Log): Promise<void> {
  const eventName = (log as any).eventName;

  switch (eventName) {
    case 'AgentRegistered':
      await processAgentRegistered(log);
      break;
    case 'AgentStatusChanged':
      await processAgentStatusChanged(log);
      break;
    case 'ReputationUpdated':
      await processReputationUpdated(log);
      break;
    case 'TaskCompleted':
      await processTaskCompleted(log);
      break;
    case 'TaskFailed':
      await processTaskFailed(log);
      break;
    case 'AgentWalletUpdated':
      await processAgentWalletUpdated(log);
      break;
    case 'AgentMetadataUpdated':
      await processAgentMetadataUpdated(log);
      break;
    default:
      console.warn(`Unknown AgentRegistry event: ${eventName}`);
  }
}
