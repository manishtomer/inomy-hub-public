/**
 * AuctionService - Auction and bid management
 *
 * Handles bid submission, winner selection, and auction closure.
 * Uses shared scoring logic from autopilot.
 */

import { supabase } from '@/lib/supabase';
import { calculateBidScore } from '@/lib/agent-runtime/autopilot';
import { createEvent } from '@/lib/api-helpers';
import { economyService } from '../economy/EconomyService';
import type { AgentCostStructure } from '@/lib/agent-runtime/types';
import type { Bid, SubmitBidInput, WinnerResult, AuctionResult, AgentWithPolicy, Task } from '../types';

export class AuctionService {
  /**
   * Submit a single bid
   */
  async submitBid(input: SubmitBidInput): Promise<Bid | null> {
    const { data, error } = await supabase
      .from('bids_cache')
      .insert({
        task_id: input.taskId,
        agent_id: input.agentId,
        bidder_wallet: input.bidderWallet,
        amount: input.amount,
        status: 'PENDING',
        policy_used: input.policyUsed || null,
        round_number: input.roundNumber || null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[AuctionService] Failed to submit bid:', error);
      return null;
    }

    return data as Bid;
  }

  /**
   * Submit multiple bids in batch.
   * If agentCostsMap is provided, deducts bid submission cost per agent.
   */
  async submitBatchBids(
    inputs: SubmitBidInput[],
    agentCostsMap?: Map<string, AgentCostStructure>
  ): Promise<Bid[]> {
    if (inputs.length === 0) return [];

    const bidsToInsert = inputs.map(input => ({
      task_id: input.taskId,
      agent_id: input.agentId,
      bidder_wallet: input.bidderWallet,
      amount: input.amount,
      status: 'PENDING',
      policy_used: input.policyUsed || null,
      round_number: input.roundNumber || null,
      created_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from('bids_cache')
      .insert(bidsToInsert)
      .select();

    if (error) {
      console.error('[AuctionService] Failed to submit batch bids:', JSON.stringify(error));
      console.error('[AuctionService] First bid sample:', JSON.stringify(bidsToInsert[0]));
      return [];
    }

    // Deduct bid costs per agent if costs map provided
    if (agentCostsMap && data) {
      const deductions = new Map<string, number>();
      for (const bid of inputs) {
        const costs = agentCostsMap.get(bid.agentId);
        if (costs) {
          const current = deductions.get(bid.agentId) || 0;
          deductions.set(bid.agentId, current + costs.per_bid.bid_submission);
        }
      }
      for (const [agentId, totalCost] of deductions) {
        await economyService.adjustBalance(agentId, -totalCost);
      }
    }

    return (data || []) as Bid[];
  }

  /**
   * Get all bids for a task
   */
  async getBidsForTask(taskId: string): Promise<Bid[]> {
    const { data, error } = await supabase
      .from('bids_cache')
      .select('*')
      .eq('task_id', taskId)
      .order('amount', { ascending: true });

    if (error) {
      console.error('[AuctionService] Failed to get bids for task:', error);
      return [];
    }

    return (data || []) as Bid[];
  }

  /**
   * Select winner for a task based on highest score
   * Score = (50 + sqrt(reputation)) / bid
   */
  async selectWinner(
    taskId: string,
    agents: AgentWithPolicy[]
  ): Promise<WinnerResult | null> {
    const bids = await this.getBidsForTask(taskId);
    if (bids.length === 0) return null;

    // Calculate scores from agent reputation and bid amount
    // (score column doesn't exist in DB, so we compute it)
    const bidsWithScores = bids.map(bid => {
      const agent = agents.find(a => a.id === bid.agent_id);
      const rep = agent?.reputation || 0;
      const score = calculateBidScore(rep, bid.amount);
      return { ...bid, score };
    });

    // Sort by score descending (highest score wins)
    const sortedBids = bidsWithScores.sort((a, b) => b.score - a.score);
    const winningBid = sortedBids[0];

    // Find the winning agent
    const agent = agents.find(a => a.id === winningBid.agent_id);
    if (!agent) {
      console.error('[AuctionService] Winning agent not found:', winningBid.agent_id);
      return null;
    }

    return {
      winningBid,
      agent,
      score: winningBid.score,
      allBids: bidsWithScores,
    };
  }

  /**
   * Mark a bid as won
   */
  async markBidAsWon(bidId: string): Promise<Bid | null> {
    const { data, error } = await supabase
      .from('bids_cache')
      .update({ status: 'WON' })
      .eq('id', bidId)
      .select()
      .single();

    if (error) {
      console.error('[AuctionService] Failed to mark bid as won:', error);
      return null;
    }

    return data as Bid;
  }

  /**
   * Mark multiple bids as lost
   */
  async markBidsAsLost(bidIds: string[]): Promise<number> {
    if (bidIds.length === 0) return 0;

    const { error, count } = await supabase
      .from('bids_cache')
      .update({ status: 'LOST' })
      .in('id', bidIds);

    if (error) {
      console.error('[AuctionService] Failed to mark bids as lost:', error);
      return 0;
    }

    return count || bidIds.length;
  }

  /**
   * Close an auction: select winner, update bids, assign task
   */
  async closeAuction(
    task: Task,
    agents: AgentWithPolicy[]
  ): Promise<AuctionResult | null> {
    const winnerResult = await this.selectWinner(task.id, agents);
    if (!winnerResult) {
      return null;
    }

    const { winningBid, agent, allBids } = winnerResult;

    // Mark winning bid
    await this.markBidAsWon(winningBid.id);

    // Mark losing bids
    const losingBidIds = allBids
      .filter(b => b.id !== winningBid.id)
      .map(b => b.id);
    await this.markBidsAsLost(losingBidIds);

    // Update task to ASSIGNED with winner info (task-delivery endpoint needs this)
    const { error: taskUpdateError } = await supabase.from('tasks').update({
      status: 'ASSIGNED',
      assigned_agent_id: agent.id,
      winning_bid_id: winningBid.id,
    }).eq('id', task.id);

    if (taskUpdateError) {
      console.error(`[AuctionService] Failed to update task ${task.id} to ASSIGNED:`, taskUpdateError);
    }

    // Record task_assigned event
    createEvent({
      event_type: 'task_assigned',
      description: `Task ${task.type} assigned to ${agent.name} for ${winningBid.amount.toFixed(4)} USDC (score: ${winningBid.score.toFixed(1)}, ${allBids.length} bids)`,
      agent_wallets: [agent.wallet_address],
      amount: winningBid.amount,
      metadata: {
        task_id: task.id,
        task_type: task.type,
        winning_bid: winningBid.amount,
        score: winningBid.score,
        total_bids: allBids.length,
        currency: 'USDC',
      },
    }).catch(() => {}); // Non-blocking

    return {
      task,
      winningBid,
      agent,
      losingBidIds,
      losingBids: allBids.filter(b => b.id !== winningBid.id),
      revenue: winningBid.amount,
    };
  }

  /**
   * Calculate bid score using shared autopilot logic
   */
  calculateScore(reputation: number, bidAmount: number): number {
    return calculateBidScore(reputation, bidAmount);
  }

  /**
   * Get recent bids for an agent (for exception checking)
   */
  async getRecentBidsForAgent(
    agentId: string,
    limit: number = 20
  ): Promise<Bid[]> {
    const { data, error } = await supabase
      .from('bids_cache')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return [];
    }

    return (data || []) as Bid[];
  }

  /**
   * Check if an agent has already bid on a task
   */
  async hasAgentBidOnTask(agentId: string, taskId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('bids_cache')
      .select('id')
      .eq('task_id', taskId)
      .eq('agent_id', agentId)
      .limit(1);

    if (error) return false;
    return (data && data.length > 0) || false;
  }

  /**
   * Submit a bid for an agent (used by runner.ts).
   * If costs are provided, deducts bid submission cost from agent balance.
   */
  async submitBidForAgent(
    agentId: string,
    taskId: string,
    amount: number,
    _reputation: number,
    walletAddress: string,
    costs?: AgentCostStructure
  ): Promise<Bid | null> {
    const { data, error } = await supabase
      .from('bids_cache')
      .insert({
        task_id: taskId,
        agent_id: agentId,
        bidder_wallet: walletAddress,
        amount: amount,
        status: 'PENDING',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[AuctionService] Failed to submit bid for agent:', error);
      return null;
    }

    // Deduct bid submission cost if costs provided
    if (costs) {
      await economyService.adjustBalance(agentId, -costs.per_bid.bid_submission);
    }

    return data as Bid;
  }
}

// Singleton instance for convenience
export const auctionService = new AuctionService();
