/**
 * MemoryService - Fire-and-forget memory creation
 *
 * Wraps createPersonalMemory() for each event type.
 * All methods are async but callers should .catch() errors (fire-and-forget).
 */

import { createPersonalMemory } from '@/lib/agent-runtime/personal-memory';
import type { MemoryContext } from '@/lib/agent-runtime/memory-types';
import type { AgentWithPolicy } from '../types';

export class MemoryService {
  private buildContext(agent: AgentWithPolicy, roundNumber: number): MemoryContext {
    return {
      identity: {
        name: agent.name,
        type: agent.type,
        personality: agent.personality,
      },
      balance: agent.balance,
      reputation: agent.reputation,
      currentRound: roundNumber,
    };
  }

  async createBidMemory(
    agentId: string, taskId: string, taskType: string,
    bidAmount: number, roundNumber: number, agent: AgentWithPolicy
  ): Promise<void> {
    const context = this.buildContext(agent, roundNumber);
    await createPersonalMemory(agentId, 'bid_outcome', {
      task_id: taskId, task_type: taskType, my_bid: bidAmount, outcome: 'pending',
    }, roundNumber, context, 'Bid submitted');
  }

  async createTaskExecutionMemory(
    agentId: string, taskId: string, taskType: string,
    revenue: number, cost: number, roundNumber: number, agent: AgentWithPolicy
  ): Promise<void> {
    const context = this.buildContext(agent, roundNumber);
    await createPersonalMemory(agentId, 'task_execution', {
      task_id: taskId, task_type: taskType, revenue, cost,
      profit: revenue - cost, margin: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0,
    }, roundNumber, context, 'Task completed successfully');
  }

  async createExceptionMemory(
    agentId: string, exceptionType: string, details: string,
    wasHandled: boolean, roundNumber: number, agent: AgentWithPolicy
  ): Promise<void> {
    const context = this.buildContext(agent, roundNumber);
    await createPersonalMemory(agentId, 'exception_handled', {
      exception_type: exceptionType, details, was_handled: wasHandled,
    }, roundNumber, context, `Exception detected: ${exceptionType}`, 0.7);
  }

  async createQBRMemory(
    agentId: string, triggerReason: string,
    roundNumber: number, agent: AgentWithPolicy
  ): Promise<void> {
    const context = this.buildContext(agent, roundNumber);
    await createPersonalMemory(agentId, 'qbr_insight', {
      trigger_reason: triggerReason, round_number: roundNumber,
    }, roundNumber, context, 'Quarterly Business Review completed', 0.8);
  }

  /**
   * Create a complete bid outcome memory (won or lost) with full context.
   * Called AFTER the auction resolves, so we always have the outcome.
   * This avoids the race condition of creating at bid time and patching later.
   */
  async createBidOutcomeMemory(
    agentId: string,
    taskId: string,
    taskType: string,
    won: boolean,
    bidAmount: number,
    roundNumber: number,
    agent: AgentWithPolicy,
    winningBidAmount?: number,
    winnerName?: string,
    winnerAgentId?: string,
  ): Promise<void> {
    const context = this.buildContext(agent, roundNumber);

    const data: Record<string, unknown> = {
      task_id: taskId,
      task_type: taskType,
      my_bid: bidAmount,
      won,
      outcome: won ? 'won' : 'lost',
    };

    if (won) {
      data.bid_amount = bidAmount;
    } else {
      data.winning_bid = winningBidAmount;
      data.winner_name = winnerName || 'unknown';
      data.winner_agent_id = winnerAgentId;
      if (winningBidAmount && bidAmount) {
        data.bid_delta = bidAmount - winningBidAmount;
        data.bid_delta_pct = `${(((bidAmount - winningBidAmount) / winningBidAmount) * 100).toFixed(1)}%`;
      }
    }

    const narrative = won
      ? `Won ${taskType} at $${bidAmount.toFixed(4)}`
      : `Lost ${taskType}. My bid $${bidAmount.toFixed(4)} vs winner ${winnerName || '?'} at $${(winningBidAmount || 0).toFixed(4)}`;

    await createPersonalMemory(agentId, 'bid_outcome', data, roundNumber, context, narrative);
  }

  async createPartnershipMemory(
    agentId: string, partnerId: string, partnerName: string,
    eventType: 'formed' | 'ended' | 'rejected', split: number,
    reason: string, roundNumber: number, agent: AgentWithPolicy
  ): Promise<void> {
    const context = this.buildContext(agent, roundNumber);
    await createPersonalMemory(agentId, 'partnership_event', {
      partner_id: partnerId, partner_name: partnerName,
      event_type: eventType, split, reason,
    }, roundNumber, context, `Partnership ${eventType}: ${partnerName}`,
    eventType === 'formed' ? 0.7 : 0.5);
  }
}

export const memoryService = new MemoryService();
