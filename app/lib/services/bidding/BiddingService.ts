/**
 * BiddingService - Agent bid generation
 *
 * Generates bids for agents based on their policies and personalities.
 * Uses shared bidding logic from autopilot.
 */

import {
  calculateAllInCost,
  calculateBidScore,
  evaluateAuction,
} from '@/lib/agent-runtime/autopilot';
import { PERSONALITY_DEFAULTS, AGENT_COSTS } from '@/lib/agent-runtime/constants';
import type { AgentPolicy } from '@/lib/agent-runtime/types';
import type {
  AgentWithPolicy,
  Task,
  BidDecision,
  SubmitBidInput,
  BidPolicyTrace,
  TaskType,
} from '../types';
import type { AgentType } from '@/types/database';

// Map task types to compatible agent types
const TASK_TO_AGENT_TYPE: Record<TaskType, AgentType> = {
  CATALOG: 'CATALOG' as AgentType,
  REVIEW: 'REVIEW' as AgentType,
  CURATION: 'CURATION' as AgentType,
  SELLER: 'SELLER' as AgentType,
};

export class BiddingService {
  /**
   * Generate a bid decision for a single agent on a task.
   * Uses evaluateAuction() from autopilot for comprehensive bid evaluation
   * including max_bid capping, min_margin fallback, and affordability checks.
   */
  generateBidForTask(agent: AgentWithPolicy, task: Task): BidDecision {
    // Check type compatibility
    const requiredType = TASK_TO_AGENT_TYPE[task.type];
    if (agent.type !== requiredType) {
      return {
        action: 'skip',
        reason: `Agent type ${agent.type} cannot bid on ${task.type} tasks`,
      };
    }

    // Check on-chain registration
    if (!agent.chain_agent_id) {
      return {
        action: 'skip',
        reason: 'Agent not registered on-chain',
      };
    }

    // Check balance
    if (agent.balance <= 0) {
      return {
        action: 'skip',
        reason: 'Insufficient balance',
      };
    }

    // Build full policy from agent policy or personality defaults
    const defaults = PERSONALITY_DEFAULTS[agent.personality] || PERSONALITY_DEFAULTS.balanced;
    const policy: AgentPolicy = agent.policy
      ? { ...defaults, ...agent.policy, bidding: { ...defaults.bidding, ...(agent.policy.bidding || {}) } } as AgentPolicy
      : defaults;

    console.log(`[BiddingService] ${agent.name} bidding policy: target_margin=${policy.bidding.target_margin}, min_margin=${policy.bidding.min_margin}, skip_below=${policy.bidding.skip_below} (source: ${agent.policy?.bidding ? 'DB policy' : 'personality default'})`);

    // Use comprehensive evaluateAuction from autopilot
    // Pass investor_share_bps so bid covers all costs including investor cut
    const costs = agent.costs || AGENT_COSTS[agent.type] || AGENT_COSTS.CATALOG;
    const decision = evaluateAuction(
      { type: task.type, max_bid: task.max_bid, id: task.id },
      policy,
      costs,
      { balance: agent.balance, reputation: agent.reputation, investor_share_bps: agent.investor_share_bps }
    );

    if (decision.action === 'skip') {
      return { action: 'skip', reason: decision.reasoning };
    }

    // Calculate score for the bid
    const score = calculateBidScore(agent.reputation, decision.amount!);
    const allInCost = calculateAllInCost(costs, agent.investor_share_bps);

    const policyTrace: BidPolicyTrace = {
      margin: decision.amount! > 0 ? (decision.amount! - allInCost) / decision.amount! : 0,
      source: agent.policy?.bidding ? 'policy' : 'personality_default',
      task_cost: allInCost,
    };

    return {
      action: 'bid',
      amount: decision.amount,
      score,
      margin: policyTrace.margin,
      policyTrace,
    };
  }

  /**
   * Generate bids for multiple agents on multiple tasks
   * Returns bids ready to submit and skipped agents with reasons
   */
  generateBidsForRound(
    tasks: Task[],
    agents: AgentWithPolicy[]
  ): {
    bids: SubmitBidInput[];
    skipped: Array<{ agentId: string; taskId: string; reason: string }>;
  } {
    const bids: SubmitBidInput[] = [];
    const skipped: Array<{ agentId: string; taskId: string; reason: string }> = [];
    // Track which agents have already bid this round (one bid per agent per round)
    const agentsWhoBid = new Set<string>();

    console.log(`[BiddingService] Generating bids for ${tasks.length} tasks with ${agents.length} agents`);
    console.log(`[BiddingService] Agent types: ${agents.map(a => `${a.name}:${a.type}`).join(', ')}`);

    for (const task of tasks) {
      // Find agents that can bid on this task type (exclude agents that already bid)
      const requiredType = TASK_TO_AGENT_TYPE[task.type];
      const matchingAgents = agents.filter(a => a.type === requiredType && !agentsWhoBid.has(a.id));
      console.log(`[BiddingService] Task ${task.type} (max_bid: ${task.max_bid.toFixed(4)}): ${matchingAgents.length} matching agents`);

      for (const agent of matchingAgents) {
        const decision = this.generateBidForTask(agent, task);

        if (decision.action === 'bid' && decision.amount && decision.score) {
          console.log(`[BiddingService] ${agent.name} bidding $${decision.amount.toFixed(4)} on ${task.type}`);
          bids.push({
            taskId: task.id,
            agentId: agent.id,
            bidderWallet: agent.wallet_address,
            amount: decision.amount,
            score: decision.score,
            policyUsed: decision.policyTrace,
          });
          agentsWhoBid.add(agent.id);
        } else {
          console.log(`[BiddingService] ${agent.name} SKIP ${task.type}: ${decision.reason}`);
          skipped.push({
            agentId: agent.id,
            taskId: task.id,
            reason: decision.reason || 'Unknown',
          });
        }
      }
    }

    return { bids, skipped };
  }

  /**
   * Get margins for an agent based on policy and personality
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

  /**
   * Get agents that can bid on a specific task type
   */
  filterAgentsForTaskType(agents: AgentWithPolicy[], taskType: TaskType): AgentWithPolicy[] {
    const requiredType = TASK_TO_AGENT_TYPE[taskType];
    return agents.filter(a => a.type === requiredType && a.balance > 0);
  }
}

// Singleton instance for convenience
export const biddingService = new BiddingService();
