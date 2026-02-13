/**
 * AgentService - Agent state and query management
 *
 * Provides consistent agent loading with policies and personalities.
 * Used by both simulation and real runtime.
 */

import { supabase } from '@/lib/supabase';
import { PERSONALITY_DEFAULTS, AGENT_COSTS } from '@/lib/agent-runtime/constants';
import type { AgentWithPolicy, AgentStatsUpdate, PersonalityType, TaskType } from '../types';
import type { AgentType } from '@/types/database';

// Map task types to compatible agent types
const TASK_TO_AGENT_TYPE: Record<TaskType, AgentType> = {
  CATALOG: 'CATALOG' as AgentType,
  REVIEW: 'REVIEW' as AgentType,
  CURATION: 'CURATION' as AgentType,
  SELLER: 'SELLER' as AgentType,
};

export class AgentService {
  /**
   * Get all active agents with their policies and personalities
   */
  async getActiveAgents(): Promise<AgentWithPolicy[]> {
    const { data: agents, error } = await supabase
      .from('agents')
      .select('*')
      .in('status', ['ACTIVE', 'LOW_FUNDS'])
      .gt('balance', 0);

    if (error || !agents) {
      console.error('[AgentService] Failed to load agents:', error);
      return [];
    }

    return this.enrichAgentsWithPolicies(agents);
  }

  /**
   * Get a single agent by ID with policy
   */
  async getAgentById(agentId: string): Promise<AgentWithPolicy | null> {
    const { data: agent, error } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single();

    if (error || !agent) {
      return null;
    }

    const enriched = await this.enrichAgentsWithPolicies([agent]);
    return enriched[0] || null;
  }

  /**
   * Get agents by type
   */
  async getAgentsByType(type: AgentType): Promise<AgentWithPolicy[]> {
    const { data: agents, error } = await supabase
      .from('agents')
      .select('*')
      .eq('type', type)
      .eq('status', 'ACTIVE')
      .gt('balance', 0);

    if (error || !agents) {
      return [];
    }

    return this.enrichAgentsWithPolicies(agents);
  }

  /**
   * Get agents that can bid on a specific task type
   */
  async getMatchingAgents(taskType: TaskType): Promise<AgentWithPolicy[]> {
    const agentType = TASK_TO_AGENT_TYPE[taskType];
    return this.getAgentsByType(agentType);
  }

  /**
   * Update agent stats (balance, reputation, etc.)
   */
  async updateAgentStats(agentId: string, updates: AgentStatsUpdate): Promise<void> {
    const { error } = await supabase
      .from('agents')
      .update(updates)
      .eq('id', agentId);

    if (error) {
      console.error(`[AgentService] Failed to update agent ${agentId}:`, error);
    }
  }

  /**
   * Refresh agent data from database (after balance changes, etc.)
   */
  async refreshAgentData(agents: AgentWithPolicy[]): Promise<AgentWithPolicy[]> {
    const agentIds = agents.map(a => a.id);

    const { data: freshAgents, error } = await supabase
      .from('agents')
      .select('*')
      .in('id', agentIds);

    if (error || !freshAgents) {
      return agents; // Return original on error
    }

    return this.enrichAgentsWithPolicies(freshAgents);
  }

  /**
   * Load policy for a specific agent
   */
  async loadAgentPolicy(agentId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await supabase
      .from('agent_policies')
      .select('policy_json')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return data.policy_json;
  }

  /**
   * Enrich agents with policies and personalities
   */
  private async enrichAgentsWithPolicies(agents: any[]): Promise<AgentWithPolicy[]> {
    // Load all policies in parallel
    const policyPromises = agents.map(agent =>
      supabase
        .from('agent_policies')
        .select('policy_json')
        .eq('agent_id', agent.id)
        .order('created_at', { ascending: false })
        .limit(1)
    );

    const policyResults = await Promise.all(policyPromises);

    return agents.map((agent, index) => {
      const policyData = policyResults[index].data?.[0]?.policy_json || null;
      const personality = (agent.personality as PersonalityType) || 'balanced';
      const agentType = agent.type as AgentType;

      const bidding = policyData?.bidding;
      console.log(`[AgentService] Loaded ${agent.name}: balance=$${(agent.balance || 0).toFixed(4)}, policy.bidding=${bidding ? `target_margin=${bidding.target_margin}, min_margin=${bidding.min_margin}` : 'none (using personality defaults)'}`);

      return {
        id: agent.id,
        name: agent.name,
        type: agentType,
        balance: agent.balance || 0,
        reputation: agent.reputation || 500,
        personality,
        policy: policyData,
        wallet_address: agent.wallet_address || agent.id,
        costs: AGENT_COSTS[agentType] || AGENT_COSTS.CATALOG,
        investor_share_bps: agent.investor_share_bps ?? 5000,
        chain_agent_id: agent.chain_agent_id ?? null,
      };
    });
  }

  /**
   * Get default margins for an agent based on personality and policy
   */
  getAgentMargins(agent: AgentWithPolicy): {
    min: number;
    max: number;
    target: number;
    skipBelowProfit: number;
  } {
    const defaults = PERSONALITY_DEFAULTS[agent.personality] || PERSONALITY_DEFAULTS.balanced;
    const policy = agent.policy?.bidding || {};

    return {
      min: (policy as any).min_margin ?? defaults.bidding.min_margin,
      max: (policy as any).max_margin ?? defaults.bidding.target_margin * 1.5,
      target: (policy as any).target_margin ?? defaults.bidding.target_margin,
      skipBelowProfit: (policy as any).skip_below_profit ?? defaults.bidding.skip_below,
    };
  }
}

// Singleton instance for convenience
export const agentService = new AgentService();
