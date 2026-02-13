/**
 * Round Diagnostics — structured trace per agent per round.
 *
 * Captures the full pipeline of numbers so we can verify:
 * - What policy the agent used (and where it came from)
 * - What costs were computed
 * - What bid was generated and its auction score
 * - Whether the agent won, and who beat them
 *
 * Logged as [RoundDiagnostics] JSON block in server logs.
 */

import { calculateTaskCost, calculateAllInCost, calculateBidScore, DEFAULT_LIVING_COST_PER_ROUND } from '@/lib/agent-runtime/autopilot';
import { AGENT_COSTS, PERSONALITY_DEFAULTS } from '@/lib/agent-runtime/constants';
import type { AgentCostStructure } from '@/lib/agent-runtime/types';
import type { AgentWithPolicy, SubmitBidInput, Task } from '../types';

export interface AgentRoundDiagnostic {
  agent: {
    id: string;
    name: string;
    type: string;
    balance: number;
    reputation: number;
  };
  policy: {
    source: 'db' | 'personality_default';
    target_margin: number;
    min_margin: number;
    skip_below: number;
  };
  costs: {
    task_cost: number;
    all_in_cost: number;
    min_profitable_bid: number;
  };
  bid: {
    task_id: string | null;
    task_type: string | null;
    target_bid: number;
    actual_bid: number;
    score: number;
    actual_margin_pct: number;
  } | null;
  auction: {
    won: boolean;
    winner_name: string | null;
    winner_bid: number | null;
    winner_score: number | null;
    my_score: number | null;
  } | null;
}

export interface RoundDiagnostics {
  round: number;
  agents: AgentRoundDiagnostic[];
}

/**
 * Build diagnostics for all agents after bidding phase.
 * Called after bids are generated but before auctions close.
 */
export function buildBiddingDiagnostics(
  roundNumber: number,
  agents: AgentWithPolicy[],
  bids: SubmitBidInput[],
  tasks: Task[],
): RoundDiagnostics {
  const agentDiags: AgentRoundDiagnostic[] = [];

  for (const agent of agents) {
    const costs: AgentCostStructure = agent.costs || AGENT_COSTS[agent.type] || AGENT_COSTS.CATALOG;
    const defaults = PERSONALITY_DEFAULTS[agent.personality] || PERSONALITY_DEFAULTS.balanced;
    const policy = agent.policy
      ? { ...defaults, ...agent.policy, bidding: { ...defaults.bidding, ...(agent.policy.bidding || {}) } }
      : defaults;

    const taskCost = calculateTaskCost(costs);
    const investorBps = agent.investor_share_bps ?? 5000;
    const allInCost = calculateAllInCost(costs, investorBps, DEFAULT_LIVING_COST_PER_ROUND);

    const bidCostPerBid = costs.per_bid.bid_submission;
    // Investor share is on NET profit; at the floor, investor gets $0
    const minProfitableBid = taskCost + bidCostPerBid;

    const targetMargin = policy.bidding.target_margin;
    const minMargin = policy.bidding.min_margin;
    const skipBelow = policy.bidding.skip_below;
    const targetBid = allInCost / (1 - targetMargin);

    // Find this agent's bid
    const agentBid = bids.find(b => b.agentId === agent.id);
    const bidTask = agentBid ? tasks.find(t => t.id === agentBid.taskId) : null;

    const actualBid = agentBid?.amount || 0;
    const actualScore = agentBid?.score || 0;
    const actualMargin = actualBid > 0 ? ((actualBid - allInCost) / actualBid) * 100 : 0;

    agentDiags.push({
      agent: {
        id: agent.id,
        name: agent.name,
        type: agent.type,
        balance: agent.balance,
        reputation: agent.reputation,
      },
      policy: {
        source: agent.policy?.bidding ? 'db' : 'personality_default',
        target_margin: targetMargin,
        min_margin: minMargin,
        skip_below: skipBelow,
      },
      costs: {
        task_cost: taskCost,
        all_in_cost: allInCost,
        min_profitable_bid: minProfitableBid,
      },
      bid: agentBid ? {
        task_id: agentBid.taskId,
        task_type: bidTask?.type || null,
        target_bid: targetBid,
        actual_bid: actualBid,
        score: actualScore,
        actual_margin_pct: actualMargin,
      } : null,
      auction: null, // filled in after auction closure
    });
  }

  return { round: roundNumber, agents: agentDiags };
}

/**
 * Enrich diagnostics with auction results.
 * Called after auctions close.
 */
export function enrichWithAuctionResults(
  diagnostics: RoundDiagnostics,
  auctionResults: Array<{
    task: Task;
    winningBid: { id: string; amount: number; agent_id: string };
    winnerName: string;
    losingBids: Array<{ agent_id: string; amount: number }>;
  }>,
  agents: AgentWithPolicy[],
): RoundDiagnostics {
  for (const diag of diagnostics.agents) {
    if (!diag.bid) continue;

    // Find the auction result for this agent's task
    const auction = auctionResults.find(ar => ar.task.id === diag.bid!.task_id);
    if (!auction) continue;

    const won = auction.winningBid.agent_id === diag.agent.id;
    const winnerAgent = agents.find(a => a.id === auction.winningBid.agent_id);
    const winnerRep = winnerAgent?.reputation || 0;
    const winnerScore = calculateBidScore(winnerRep, auction.winningBid.amount);

    diag.auction = {
      won,
      winner_name: auction.winnerName,
      winner_bid: auction.winningBid.amount,
      winner_score: winnerScore,
      my_score: diag.bid.score,
    };
  }

  return diagnostics;
}

/**
 * Log diagnostics as structured JSON.
 */
export function logDiagnostics(diagnostics: RoundDiagnostics): void {
  // Compact summary line
  const bidders = diagnostics.agents.filter(a => a.bid);
  const winners = diagnostics.agents.filter(a => a.auction?.won);

  console.log(`[RoundDiagnostics] Round ${diagnostics.round}: ${bidders.length} bidders, ${winners.length} winners`);

  // Per-agent detail (compact single-line JSON for grep-ability)
  for (const diag of diagnostics.agents) {
    if (!diag.bid) continue;

    const compact = {
      agent: diag.agent.name,
      rep: diag.agent.reputation,
      policy_src: diag.policy.source,
      target_margin: `${(diag.policy.target_margin * 100).toFixed(1)}%`,
      all_in_cost: `$${diag.costs.all_in_cost.toFixed(4)}`,
      target_bid: `$${diag.bid.target_bid.toFixed(4)}`,
      actual_bid: `$${diag.bid.actual_bid.toFixed(4)}`,
      score: diag.bid.score.toFixed(1),
      margin: `${diag.bid.actual_margin_pct.toFixed(1)}%`,
      won: diag.auction?.won ?? 'pending',
      winner: diag.auction?.winner_name ?? 'pending',
      winner_bid: diag.auction?.winner_bid ? `$${diag.auction.winner_bid.toFixed(4)}` : 'N/A',
      winner_score: diag.auction?.winner_score?.toFixed(1) ?? 'N/A',
    };

    console.log(`[RoundDiagnostics] ${JSON.stringify(compact)}`);
  }
}
