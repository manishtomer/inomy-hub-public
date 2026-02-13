/**
 * Action Executor
 *
 * Executes agent actions against the database (demo mode) or blockchain (chain mode).
 * Handles bids, partnerships, task execution, and balance updates.
 *
 * In demo mode, all actions write directly to Supabase.
 * In chain mode, actions call smart contracts (future implementation).
 */

import { supabase } from '../supabase';
import type { ActionResult, AgentCostStructure } from './types';
import { randomUUID } from 'crypto';

// ============================================================================
// BID ACTIONS
// ============================================================================

/**
 * Submit a bid on a task auction.
 *
 * Demo mode: INSERT into bids_cache table
 * Chain mode: Call TaskAuction.submitBid (not yet implemented)
 */
export async function submitBid(
  agentId: string,
  taskId: string,
  amount: number,
  config: { demo_mode: boolean }
): Promise<ActionResult> {
  try {
    if (!config.demo_mode) {
      console.warn('Chain mode not yet implemented, falling back to demo mode');
    }

    // Get agent's wallet address
    const { data: agentData, error: agentError } = await supabase
      .from('agents')
      .select('wallet_address')
      .eq('id', agentId)
      .single();

    if (agentError || !agentData) {
      return {
        success: false,
        error: `Failed to fetch agent wallet: ${agentError?.message || 'Agent not found'}`,
      };
    }

    // Insert bid into bids_cache
    const { error: bidError } = await supabase
      .from('bids_cache')
      .insert({
        task_id: taskId,
        agent_id: agentId,
        bidder_wallet: agentData.wallet_address,
        amount: amount,
        status: 'PENDING',
        estimated_duration: null,
        proposal_uri: null,
        chain_bid_id: null,
        chain_task_id: null,
        last_synced_block: 0,
      });

    if (bidError) {
      return {
        success: false,
        error: `Failed to submit bid: ${bidError.message}`,
      };
    }

    return {
      success: true,
      cost: 0, // In demo mode, no on-chain cost
    };
  } catch (err) {
    console.error('Exception submitting bid:', err);
    return {
      success: false,
      error: `Exception: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

// ============================================================================
// PARTNERSHIP ACTIONS
// ============================================================================

/**
 * Accept a partnership proposal.
 *
 * Demo mode: UPDATE partnerships_cache SET status='ACTIVE'
 * Chain mode: Call Partnership.acceptProposal (not yet implemented)
 */
export async function acceptPartnership(
  _agentId: string,
  partnershipId: string,
  config: { demo_mode: boolean }
): Promise<ActionResult> {
  try {
    if (!config.demo_mode) {
      console.warn('Chain mode not yet implemented, falling back to demo mode');
    }

    const { error } = await supabase
      .from('partnerships_cache')
      .update({ status: 'ACTIVE' })
      .eq('id', partnershipId);

    if (error) {
      return {
        success: false,
        error: `Failed to accept partnership: ${error.message}`,
      };
    }

    return {
      success: true,
      cost: 0,
    };
  } catch (err) {
    console.error('Exception accepting partnership:', err);
    return {
      success: false,
      error: `Exception: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

/**
 * Reject a partnership proposal.
 *
 * Demo mode: UPDATE partnerships_cache SET status='DISSOLVED'
 * Chain mode: Call Partnership.rejectProposal (not yet implemented)
 */
export async function rejectPartnership(
  _agentId: string,
  partnershipId: string,
  config: { demo_mode: boolean }
): Promise<ActionResult> {
  try {
    if (!config.demo_mode) {
      console.warn('Chain mode not yet implemented, falling back to demo mode');
    }

    const { error } = await supabase
      .from('partnerships_cache')
      .update({ status: 'DISSOLVED' })
      .eq('id', partnershipId);

    if (error) {
      return {
        success: false,
        error: `Failed to reject partnership: ${error.message}`,
      };
    }

    return {
      success: true,
      cost: 0,
    };
  } catch (err) {
    console.error('Exception rejecting partnership:', err);
    return {
      success: false,
      error: `Exception: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

/**
 * Propose a new partnership.
 *
 * Demo mode: INSERT into partnerships_cache with PROPOSED status
 * Chain mode: Call Partnership.proposePartnership (not yet implemented)
 */
export async function proposePartnership(
  agentId: string,
  targetAgentId: string,
  proposerSplit: number,
  config: { demo_mode: boolean }
): Promise<ActionResult> {
  try {
    if (!config.demo_mode) {
      console.warn('Chain mode not yet implemented, falling back to demo mode');
    }

    // Get wallet addresses for both agents
    const { data: agentsData, error: agentsError } = await supabase
      .from('agents')
      .select('id, wallet_address')
      .in('id', [agentId, targetAgentId]);

    if (agentsError || !agentsData || agentsData.length !== 2) {
      return {
        success: false,
        error: 'Failed to fetch agent wallet addresses',
      };
    }

    const proposerAgent = agentsData.find(a => a.id === agentId);
    const targetAgent = agentsData.find(a => a.id === targetAgentId);

    if (!proposerAgent || !targetAgent) {
      return {
        success: false,
        error: 'Agent not found',
      };
    }

    const targetSplit = 100 - proposerSplit;

    // Insert partnership proposal
    const { error: insertError } = await supabase
      .from('partnerships_cache')
      .insert({
        partner_a_wallet: proposerAgent.wallet_address,
        partner_b_wallet: targetAgent.wallet_address,
        split_a: proposerSplit,
        split_b: targetSplit,
        balance: 0,
        status: 'PROPOSED',
        partnership_address: null,
        last_synced_block: 0,
      });

    if (insertError) {
      return {
        success: false,
        error: `Failed to propose partnership: ${insertError.message}`,
      };
    }

    return {
      success: true,
      cost: 0,
    };
  } catch (err) {
    console.error('Exception proposing partnership:', err);
    return {
      success: false,
      error: `Exception: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

// ============================================================================
// TASK EXECUTION
// ============================================================================

/**
 * Execute a task (simulated for demo).
 * Generates a mock output hash and calculates cost based on agent type.
 *
 * Returns the output hash and cost.
 */
export async function executeTask(
  _agentId: string,
  _taskId: string,
  _agentType: string,
  costs: AgentCostStructure
): Promise<{ outputHash: string; cost: number }> {
  try {
    // Calculate total task execution cost
    const cost =
      costs.per_task.llm_inference +
      costs.per_task.data_retrieval +
      costs.per_task.storage +
      costs.per_task.submission;

    // Generate mock output hash (in production, this would be actual work output)
    const outputHash = `0x${randomUUID().replace(/-/g, '')}`;

    return {
      outputHash,
      cost,
    };
  } catch (err) {
    console.error('Exception executing task:', err);
    throw err;
  }
}

/**
 * Submit completed work for a task.
 *
 * Demo mode: UPDATE tasks SET status='COMPLETED', output_hash=...
 * Chain mode: Call TaskAuction.completeTask (not yet implemented)
 */
export async function submitWork(
  _agentId: string,
  taskId: string,
  _outputHash: string,
  config: { demo_mode: boolean }
): Promise<ActionResult> {
  try {
    if (!config.demo_mode) {
      console.warn('Chain mode not yet implemented, falling back to demo mode');
    }

    const { error } = await supabase
      .from('tasks')
      .update({
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
        // Note: output_hash field doesn't exist in current schema
        // In production, this would be added to tasks table or stored separately
      })
      .eq('id', taskId);

    if (error) {
      return {
        success: false,
        error: `Failed to submit work: ${error.message}`,
      };
    }

    return {
      success: true,
      cost: 0,
    };
  } catch (err) {
    console.error('Exception submitting work:', err);
    return {
      success: false,
      error: `Exception: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

// ============================================================================
// BALANCE MANAGEMENT
// ============================================================================

/**
 * Update agent balance in the agents table.
 * Called after earning revenue or spending on tasks/bids.
 *
 * Delta can be positive (revenue) or negative (cost).
 */
export async function updateAgentBalance(agentId: string, delta: number): Promise<void> {
  try {
    // Get current balance
    const { data: agentData, error: fetchError } = await supabase
      .from('agents')
      .select('balance')
      .eq('id', agentId)
      .single();

    if (fetchError || !agentData) {
      console.error('Failed to fetch agent balance:', fetchError);
      throw new Error('Agent not found');
    }

    const newBalance = agentData.balance + delta;

    // Update balance
    const { error: updateError } = await supabase
      .from('agents')
      .update({ balance: newBalance })
      .eq('id', agentId);

    if (updateError) {
      console.error('Failed to update agent balance:', updateError);
      throw new Error(`Failed to update balance: ${updateError.message}`);
    }
  } catch (err) {
    console.error('Exception updating agent balance:', err);
    throw err;
  }
}

// ============================================================================
// ECONOMY EVENTS
// ============================================================================

/**
 * Create an economy event for the activity feed.
 * Events are displayed in the UI to show agent and market activity.
 */
export async function createAgentEconomyEvent(
  eventType: string,
  description: string,
  agentId: string,
  amount?: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    // Get agent wallet address
    const { data: agentData, error: agentError } = await supabase
      .from('agents')
      .select('wallet_address')
      .eq('id', agentId)
      .single();

    if (agentError || !agentData) {
      console.error('Failed to fetch agent for event:', agentError);
      return;
    }

    const { error } = await supabase
      .from('economy_events')
      .insert({
        event_type: eventType,
        description: description,
        agent_wallets: [agentData.wallet_address],
        investor_wallet: null,
        amount: amount || null,
        tx_hash: null,
        block_number: null,
        metadata: metadata || {},
      });

    if (error) {
      console.error('Failed to create economy event:', error);
    }
  } catch (err) {
    console.error('Exception creating economy event:', err);
  }
}
