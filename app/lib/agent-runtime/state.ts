/**
 * Agent State Manager
 *
 * Handles loading and saving agent state from Supabase.
 * Manages runtime statistics, policies, and agent identity.
 *
 * All functions use the existing Supabase client pattern from lib/supabase.ts
 * and follow the database schema defined in agent_runtime_tables.sql.
 */

import { supabase } from '../supabase';
import type {
  AgentRuntimeState,
  AgentIdentity,
  AgentPolicy,
  PersonalityType,
  AgentCostStructure
} from './types';
import type { Agent } from '@/types/database';

// ============================================================================
// RUNTIME STATE MANAGEMENT
// ============================================================================

/**
 * Load runtime state for an agent from agent_runtime_state table.
 * Returns null if not found.
 */
export async function loadRuntimeState(agentId: string): Promise<AgentRuntimeState | null> {
  try {
    const { data, error } = await supabase
      .from('agent_runtime_state')
      .select('*')
      .eq('agent_id', agentId)
      .single();

    if (error) {
      console.error('Error loading runtime state:', error);
      return null;
    }

    if (!data) {
      return null;
    }

    // Map database fields to AgentRuntimeState
    return {
      agent_id: data.agent_id,
      current_round: data.current_round,
      consecutive_losses: data.consecutive_losses,
      consecutive_wins: data.consecutive_wins,
      total_bids: data.total_bids,
      total_wins: data.total_wins,
      total_revenue: parseFloat(data.total_revenue),
      total_costs: parseFloat(data.total_costs),
      total_brain_wakeups: data.total_brain_wakeups,
      total_brain_cost: parseFloat(data.total_brain_cost),
      total_policy_changes: data.total_policy_changes ?? 0,
      win_rate_last_20: parseFloat(data.win_rate_last_20),
      reputation_at_last_check: parseFloat(data.reputation_at_last_check),
      win_rate_at_last_check: parseFloat(data.win_rate_at_last_check),
      is_running: data.is_running,
      last_active_at: data.last_active_at,
      last_brain_wakeup_round: data.last_brain_wakeup_round ?? 0,
      last_policy_change_round: data.last_policy_change_round ?? 0,
      metrics_at_last_change: data.metrics_at_last_change ?? null,
    };
  } catch (err) {
    console.error('Exception loading runtime state:', err);
    return null;
  }
}

/**
 * Save updated runtime state to agent_runtime_state table.
 * Uses upsert with onConflict on agent_id.
 */
export async function saveRuntimeState(state: AgentRuntimeState): Promise<void> {
  try {
    const { error } = await supabase
      .from('agent_runtime_state')
      .upsert({
        agent_id: state.agent_id,
        current_round: state.current_round,
        consecutive_losses: state.consecutive_losses,
        consecutive_wins: state.consecutive_wins,
        total_bids: state.total_bids,
        total_wins: state.total_wins,
        total_revenue: state.total_revenue,
        total_costs: state.total_costs,
        total_brain_wakeups: state.total_brain_wakeups,
        total_brain_cost: state.total_brain_cost,
        total_policy_changes: state.total_policy_changes,
        win_rate_last_20: state.win_rate_last_20,
        reputation_at_last_check: state.reputation_at_last_check,
        win_rate_at_last_check: state.win_rate_at_last_check,
        is_running: state.is_running,
        last_active_at: state.last_active_at || new Date().toISOString(),
        last_brain_wakeup_round: state.last_brain_wakeup_round,
        last_policy_change_round: state.last_policy_change_round,
        metrics_at_last_change: state.metrics_at_last_change,
      }, { onConflict: 'agent_id' });

    if (error) {
      console.error('Error saving runtime state:', error);
      throw new Error(`Failed to save runtime state: ${error.message}`);
    }
  } catch (err) {
    console.error('Exception saving runtime state:', err);
    throw err;
  }
}

/**
 * Initialize a fresh runtime state for a new agent.
 * Returns the newly created state.
 */
export async function initializeRuntimeState(agentId: string): Promise<AgentRuntimeState> {
  const newState: AgentRuntimeState = {
    agent_id: agentId,
    current_round: 0,
    consecutive_losses: 0,
    consecutive_wins: 0,
    total_bids: 0,
    total_wins: 0,
    total_revenue: 0,
    total_costs: 0,
    total_brain_wakeups: 0,
    total_brain_cost: 0,
    total_policy_changes: 0,
    win_rate_last_20: 0,
    reputation_at_last_check: 500,
    win_rate_at_last_check: 0,
    is_running: false,
    last_active_at: null,
    last_brain_wakeup_round: 0,
    last_policy_change_round: 0,
    metrics_at_last_change: null,
  };

  await saveRuntimeState(newState);
  return newState;
}

// ============================================================================
// POLICY MANAGEMENT
// ============================================================================

/**
 * Load the current policy for an agent from agent_policies table.
 * Returns null if no policy exists (brain needs to generate initial policy).
 */
export async function loadPolicy(agentId: string): Promise<{ policy: AgentPolicy; version: number; lastQBRRound: number } | null> {
  try {
    const { data, error } = await supabase
      .from('agent_policies')
      .select('*')
      .eq('agent_id', agentId)
      .single();

    if (error) {
      console.error('Error loading policy:', error);
      return null;
    }

    if (!data) {
      return null;
    }

    return {
      policy: data.policy_json as AgentPolicy,
      version: data.policy_version,
      lastQBRRound: data.last_qbr_round || 0,
    };
  } catch (err) {
    console.error('Exception loading policy:', err);
    return null;
  }
}

/**
 * Save a policy update to agent_policies table.
 * Increments policy_version and returns the new version number.
 */
export async function savePolicy(
  agentId: string,
  policy: AgentPolicy,
  personality: PersonalityType
): Promise<number> {
  try {
    // Get current version
    const current = await loadPolicy(agentId);
    const newVersion = current ? current.version + 1 : 1;

    const { error } = await supabase
      .from('agent_policies')
      .upsert({
        agent_id: agentId,
        personality: personality,
        policy_json: policy,
        policy_version: newVersion,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'agent_id' });

    if (error) {
      console.error('Error saving policy:', error);
      throw new Error(`Failed to save policy: ${error.message}`);
    }

    return newVersion;
  } catch (err) {
    console.error('Exception saving policy:', err);
    throw err;
  }
}

// ============================================================================
// AGENT IDENTITY LOADING
// ============================================================================

/**
 * Load agent identity from agents table and agent_policies table.
 * Combines database agent record with personality from policies.
 * Returns null if agent not found.
 */
export async function loadAgentIdentity(agentId: string): Promise<AgentIdentity | null> {
  try {
    // Load agent record
    const { data: agentData, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single();

    if (agentError || !agentData) {
      console.error('Error loading agent:', agentError);
      return null;
    }

    const agent = agentData as Agent;

    // Load personality from policy
    const { data: policyData, error: policyError } = await supabase
      .from('agent_policies')
      .select('personality')
      .eq('agent_id', agentId)
      .single();

    if (policyError || !policyData) {
      console.error('Error loading agent personality:', policyError);
      return null;
    }

    return {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      personality: policyData.personality as PersonalityType,
      wallet_address: agent.wallet_address || '',
      chain_agent_id: agent.chain_agent_id,
      balance: agent.balance,
      reputation: agent.reputation,
      status: agent.status,
    };
  } catch (err) {
    console.error('Exception loading agent identity:', err);
    return null;
  }
}

// ============================================================================
// BID RESULT TRACKING
// ============================================================================

/**
 * Record a bid result and update runtime statistics.
 * Updates consecutive wins/losses, total bids/wins, revenue, costs, and win_rate_last_20.
 * Returns the updated state.
 */
export async function recordBidResult(
  agentId: string,
  won: boolean,
  bidAmount: number,
  revenue?: number
): Promise<AgentRuntimeState> {
  try {
    // Load current state
    let state = await loadRuntimeState(agentId);
    if (!state) {
      state = await initializeRuntimeState(agentId);
    }

    // Update bid counters
    state.total_bids += 1;

    if (won) {
      state.total_wins += 1;
      state.consecutive_wins += 1;
      state.consecutive_losses = 0;
      if (revenue) {
        state.total_revenue += revenue;
      }
    } else {
      state.consecutive_losses += 1;
      state.consecutive_wins = 0;
    }

    // Update costs (bid submission cost)
    state.total_costs += bidAmount;

    // Recalculate win_rate_last_20
    // Query last 20 bids from bids_cache
    const { data: recentBids, error: bidsError } = await supabase
      .from('bids_cache')
      .select('status')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!bidsError && recentBids && recentBids.length > 0) {
      const wins = recentBids.filter(b => b.status === 'WON' || b.status === 'ACCEPTED').length;
      state.win_rate_last_20 = wins / recentBids.length;
    } else {
      // Fallback: use total stats
      state.win_rate_last_20 = state.total_bids > 0 ? state.total_wins / state.total_bids : 0;
    }

    // Save updated state
    await saveRuntimeState(state);

    return state;
  } catch (err) {
    console.error('Exception recording bid result:', err);
    throw err;
  }
}

// ============================================================================
// BRAIN WAKEUP TRACKING
// ============================================================================

/**
 * Record a brain wake-up and its cost.
 * Updates total_brain_wakeups and total_brain_cost.
 */
export async function recordBrainWakeup(agentId: string, cost: number): Promise<void> {
  try {
    let state = await loadRuntimeState(agentId);
    if (!state) {
      state = await initializeRuntimeState(agentId);
    }

    state.total_brain_wakeups += 1;
    state.total_brain_cost += cost;
    state.total_costs += cost;

    await saveRuntimeState(state);
  } catch (err) {
    console.error('Exception recording brain wakeup:', err);
    throw err;
  }
}

// ============================================================================
// RUNWAY CALCULATION
// ============================================================================

/**
 * Calculate estimated runway (rounds until balance reaches 0).
 * Uses cost structure and recent win rate to estimate per-round burn.
 *
 * Per-round cost ≈ idle_overhead + (winRate × taskCost) + ((1-winRate) × bidCost)
 * Per-round revenue ≈ winRate × avgRevenue
 * Net per round = revenue - cost
 *
 * If net <= 0, runway = balance / Math.abs(net)
 * If net > 0, runway = Infinity (sustainable)
 */
export function calculateRunway(
  balance: number,
  costs: AgentCostStructure,
  winRate: number,
  avgRevenue: number
): number {
  // Calculate per-round cost
  const taskCost =
    costs.per_task.llm_inference +
    costs.per_task.data_retrieval +
    costs.per_task.storage +
    costs.per_task.submission;

  const bidCost = costs.per_bid.bid_submission;
  const overheadCost = costs.periodic.idle_overhead;

  // Expected cost per round
  const costPerRound = overheadCost + (winRate * taskCost) + ((1 - winRate) * bidCost);

  // Expected revenue per round
  const revenuePerRound = winRate * avgRevenue;

  // Net burn per round
  const netPerRound = revenuePerRound - costPerRound;

  if (netPerRound >= 0) {
    // Sustainable or profitable
    return Infinity;
  }

  // Calculate rounds until broke
  const runway = balance / Math.abs(netPerRound);
  return Math.floor(runway);
}

// ============================================================================
// ACTIVE AGENTS QUERY
// ============================================================================

/**
 * Get all agents that should be running in the runtime.
 * Queries agents table for ACTIVE + LOW_FUNDS agents that have policies.
 * Returns array of agent IDs.
 */
export async function getActiveAgentIds(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('agents')
      .select('id')
      .in('status', ['ACTIVE', 'LOW_FUNDS']);

    if (error) {
      console.error('Error fetching active agents:', error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Filter to only agents with policies
    const agentIds = data.map(a => a.id);
    const { data: policiesData, error: policiesError } = await supabase
      .from('agent_policies')
      .select('agent_id')
      .in('agent_id', agentIds);

    if (policiesError || !policiesData) {
      console.error('Error fetching agent policies:', policiesError);
      return [];
    }

    return policiesData.map(p => p.agent_id);
  } catch (err) {
    console.error('Exception fetching active agents:', err);
    return [];
  }
}

// ============================================================================
// RECENT BIDS QUERY
// ============================================================================

/**
 * Fetch recent bid history for an agent.
 * Returns last N bids ordered by created_at DESC.
 */
export async function getRecentBids(
  agentId: string,
  limit: number = 20
): Promise<Array<{
  task_id: string;
  amount: number;
  won: boolean;
  task_max_bid: number;
}>> {
  try {
    const { data, error } = await supabase
      .from('bids_cache')
      .select('task_id, amount, status')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching recent bids:', error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // For each bid, get the task max_bid
    const taskIds = data.map(b => b.task_id);
    const { data: tasksData, error: tasksError } = await supabase
      .from('tasks')
      .select('id, max_bid')
      .in('id', taskIds);

    if (tasksError || !tasksData) {
      console.error('Error fetching task data:', tasksError);
      return [];
    }

    const taskMaxBids = new Map(tasksData.map(t => [t.id, t.max_bid]));

    return data.map(bid => ({
      task_id: bid.task_id,
      amount: bid.amount,
      won: bid.status === 'WON' || bid.status === 'ACCEPTED',
      task_max_bid: taskMaxBids.get(bid.task_id) || 0,
    }));
  } catch (err) {
    console.error('Exception fetching recent bids:', err);
    return [];
  }
}

// ============================================================================
// MARKET CONTEXT QUERY
// ============================================================================

/**
 * Fetch market context for an agent type.
 * Calculates average winning bid, competitor count, and demand trend.
 */
export async function getMarketContext(
  agentType: string
): Promise<{
  avg_winning_bid: number;
  competitor_count: number;
  demand_trend: string;
}> {
  try {
    // Get recent winning bids for this agent type
    const { data: winningBids, error: bidsError } = await supabase
      .from('bids_cache')
      .select('amount, created_at')
      .eq('status', 'WON')
      .order('created_at', { ascending: false })
      .limit(50);

    if (bidsError || !winningBids || winningBids.length === 0) {
      return {
        avg_winning_bid: 0,
        competitor_count: 0,
        demand_trend: 'stable',
      };
    }

    // Calculate average winning bid
    const avg_winning_bid = winningBids.reduce((sum, b) => sum + b.amount, 0) / winningBids.length;

    // Count distinct agents of same type (competitors)
    const { data: agentsData } = await supabase
      .from('agents')
      .select('id')
      .eq('type', agentType)
      .in('status', ['ACTIVE', 'LOW_FUNDS']);

    const competitor_count = agentsData ? agentsData.length - 1 : 0; // Exclude self

    // Determine demand trend (compare first half vs second half of recent bids)
    let demand_trend = 'stable';
    if (winningBids.length >= 10) {
      const midpoint = Math.floor(winningBids.length / 2);
      const recentAvg = winningBids.slice(0, midpoint).reduce((sum, b) => sum + b.amount, 0) / midpoint;
      const olderAvg = winningBids.slice(midpoint).reduce((sum, b) => sum + b.amount, 0) / (winningBids.length - midpoint);

      if (recentAvg > olderAvg * 1.1) {
        demand_trend = 'growing';
      } else if (recentAvg < olderAvg * 0.9) {
        demand_trend = 'declining';
      }
    }

    return {
      avg_winning_bid,
      competitor_count,
      demand_trend,
    };
  } catch (err) {
    console.error('Exception fetching market context:', err);
    return {
      avg_winning_bid: 0,
      competitor_count: 0,
      demand_trend: 'stable',
    };
  }
}
