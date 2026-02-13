/**
 * EconomyService - Agent economics management
 *
 * Handles balance updates, revenue, costs, and economic events.
 * Used by both simulation and real runtime.
 */

import { supabase } from '@/lib/supabase';
import { createEvent, logSystemError } from '@/lib/api-helpers';
import { evaluateLifecycleStatus } from '@/lib/agent-runtime/autopilot';
import { AGENT_COSTS } from '@/lib/agent-runtime/constants';
import { AgentStatus } from '@/types/database';
import {
  TASK_OPERATIONAL_COSTS,
  COST_SINK_WALLET,
  createPaymentRecord,
  type TaskType,
} from '@/lib/x402';
import { payOperationalCostToSink, depositToEscrow, ESCROW_WALLET } from '@/lib/privy-server';
import { PLATFORM_FEE_BPS } from '@/lib/platform-config';
import type {
  AgentWithPolicy,
  EconomicResult,
  CostType,
  EconomyEventInput,
  Task,
  Bid,
} from '../types';

export interface TaskCompletionOptions {
  useBlockchain?: boolean; // default: true — real USDC transfers. false = DB only
  x402TxHash?: string;     // x402 settlement on-chain tx hash (Operator→Agent revenue payment)
}

export class EconomyService {
  /**
   * Credit revenue to an agent after winning a task
   */
  async creditRevenue(
    agentId: string,
    amount: number,
    _taskId: string,
    _metadata?: Record<string, unknown>
  ): Promise<number> {
    // Get current balance
    const { data: agent, error: getError } = await supabase
      .from('agents')
      .select('balance')
      .eq('id', agentId)
      .single();

    if (getError || !agent) {
      console.error('[EconomyService] Failed to get agent balance:', getError);
      return 0;
    }

    const newBalance = (agent.balance || 0) + amount;

    // Update balance
    const { error: updateError } = await supabase
      .from('agents')
      .update({ balance: newBalance })
      .eq('id', agentId);

    if (updateError) {
      console.error('[EconomyService] Failed to credit revenue:', updateError);
      return agent.balance || 0;
    }

    return newBalance;
  }

  /**
   * Deduct cost from an agent
   */
  async deductCost(
    agentId: string,
    amount: number,
    _costType: CostType,
    _metadata?: Record<string, unknown>
  ): Promise<number> {
    // Get current balance
    const { data: agent, error: getError } = await supabase
      .from('agents')
      .select('balance')
      .eq('id', agentId)
      .single();

    if (getError || !agent) {
      console.error('[EconomyService] Failed to get agent balance:', getError);
      return 0;
    }

    const newBalance = Math.max(0, (agent.balance || 0) - amount);

    // Update balance
    const { error: updateError } = await supabase
      .from('agents')
      .update({ balance: newBalance })
      .eq('id', agentId);

    if (updateError) {
      console.error('[EconomyService] Failed to deduct cost:', updateError);
      return agent.balance || 0;
    }

    return newBalance;
  }

  /**
   * Process task completion: credit revenue, deduct costs, update stats.
   * Single path — useBlockchain only controls whether real USDC transfers happen.
   */
  async processTaskCompletion(
    task: Task,
    winningBid: Bid,
    agent: AgentWithPolicy,
    options?: TaskCompletionOptions
  ): Promise<EconomicResult> {
    const useBlockchain = options?.useBlockchain ?? true;
    const x402TxHash = options?.x402TxHash;

    // Get current balance + stats
    const { data: currentAgent, error: getError } = await supabase
      .from('agents')
      .select('balance, reputation, total_revenue, tasks_completed, privy_wallet_id, investor_share_bps')
      .eq('id', agent.id)
      .single();

    if (getError || !currentAgent) {
      console.error('[EconomyService] Failed to get agent for completion:', getError);
      return {
        revenue: 0, cost: 0, profit: 0,
        newBalance: agent.balance, reputationChange: 0,
      };
    }

    // === PROFIT CALCULATION (single source of truth) ===
    const revenue = winningBid.amount;
    const taskType = task.type as TaskType;
    const operationalCost = TASK_OPERATIONAL_COSTS[taskType] || 0.05;
    const grossProfit = revenue - operationalCost;

    // Overhead costs (bid + living + brain amortized) — deducted before investor share.
    // These are charged separately in the simulation loop but represent real agent expenses.
    // Same constants as calculateAllInCost() in autopilot.ts.
    const overhead = 0.001 + 0.005 + (0.001 * 0.3); // bid + living + brain*wakeupRate = $0.0063
    const netProfit = grossProfit - overhead;

    // Platform takes 10% of net profit before investor/agent split
    const platformPct = PLATFORM_FEE_BPS / 10000;
    const platformCut = netProfit > 0 ? Math.round(netProfit * platformPct * 1e6) / 1e6 : 0;
    const remainingProfit = netProfit > 0 ? Math.round((netProfit - platformCut) * 1e6) / 1e6 : 0;

    const investorShareBps = currentAgent.investor_share_bps || 7500;
    const investorPct = investorShareBps / 10000;
    // Investor share is on remaining profit (after platform cut), not gross
    const investorShareTotal = remainingProfit > 0 ? Math.round(remainingProfit * investorPct * 1e6) / 1e6 : 0;
    const agentShare = Math.round((grossProfit - platformCut - investorShareTotal) * 1e6) / 1e6;

    // === BLOCKCHAIN TRANSFERS (optional) ===
    let costTxHash: string | undefined;
    let platformCutTxHash: string | undefined;
    let escrowTxHash: string | undefined;
    let holderCount = 0;

    const privyWalletId = currentAgent.privy_wallet_id;

    if (useBlockchain && privyWalletId) {
      // Pay operational cost to sink
      try {
        const costResult = await payOperationalCostToSink(privyWalletId, operationalCost);
        costTxHash = costResult.transaction_hash;
      } catch (err) {
        console.warn(`[EconomyService] Cost sink payment failed for ${agent.name}:`, err);
        await logSystemError('payment', err, {
          agent_name: agent.name,
          agent_id: agent.id,
          detail: `Cost sink payment failed ($${operationalCost} for ${task.type})`,
        });
      }

      // Pay platform profit share to sink
      if (platformCut > 0) {
        try {
          const platformResult = await payOperationalCostToSink(privyWalletId, platformCut);
          platformCutTxHash = platformResult.transaction_hash;
        } catch (err) {
          console.warn(`[EconomyService] Platform cut payment failed for ${agent.name}:`, err);
          await logSystemError('payment', err, {
            agent_name: agent.name,
            agent_id: agent.id,
            detail: `Platform cut payment failed ($${platformCut.toFixed(6)})`,
          });
        }
      }

      // Deposit investor share to escrow
      if (investorShareTotal > 0) {
        try {
          const escrowResult = await depositToEscrow(privyWalletId, investorShareTotal, agent.id);
          escrowTxHash = escrowResult.txHash;
          if (!escrowResult.success) {
            console.warn(`[EconomyService] Escrow deposit failed for ${agent.name}:`, escrowResult.error);
          }
        } catch (err) {
          console.warn(`[EconomyService] Escrow deposit error for ${agent.name}:`, err);
          await logSystemError('payment', err, {
            agent_name: agent.name,
            agent_id: agent.id,
            detail: `Escrow deposit failed ($${investorShareTotal.toFixed(6)})`,
          });
        }
      }
    }

    // === DISTRIBUTE TO TOKEN HOLDERS ===
    let totalTokenSupply: number | null = null;
    if (investorShareTotal > 0 && agent.wallet_address) {
      const { data: holders } = await supabase
        .from('token_holdings_cache')
        .select('investor_wallet, token_balance')
        .eq('agent_wallet', agent.wallet_address.toLowerCase())
        .gt('token_balance', 0);

      if (holders && holders.length > 0) {
        holderCount = holders.length;
        totalTokenSupply = holders.reduce((sum, h) => sum + Number(h.token_balance), 0);

        for (const holder of holders) {
          const sharePercent = Number(holder.token_balance) / totalTokenSupply;
          const holderAmount = Math.round(investorShareTotal * sharePercent * 1e6) / 1e6;
          if (holderAmount > 0) {
            const { error: rpcError } = await supabase.rpc('increment_investor_escrow', {
              p_agent_id: agent.id,
              p_investor_wallet: holder.investor_wallet.toLowerCase(),
              p_amount: holderAmount,
            });
            if (rpcError) {
              console.error(`[EconomyService] Escrow increment failed for ${holder.investor_wallet}:`, rpcError);
            }
          }
        }
      }
    }

    // === RECORD ESCROW AUDIT ===
    if (investorShareTotal > 0) {
      const { error: depositError } = await supabase.from('escrow_deposits').insert({
        agent_id: agent.id,
        task_id: task.id,
        gross_profit: grossProfit,
        investor_share_total: investorShareTotal,
        agent_share: agentShare,
        investor_share_bps: investorShareBps,
        holder_count: holderCount,
        total_token_supply: totalTokenSupply,
        platform_cut: platformCut,
        tx_hash: escrowTxHash,
      });
      if (depositError) {
        console.error('[EconomyService] Failed to record escrow deposit:', depositError);
      }
    }

    // === UPDATE AGENT DB (always) ===
    const newBalance = Math.round((currentAgent.balance + agentShare) * 1e6) / 1e6;
    const newRevenue = Math.round(((currentAgent.total_revenue || 0) + revenue) * 1e6) / 1e6;
    const newTasksCompleted = (currentAgent.tasks_completed || 0) + 1;
    // Reputation: random +/- up to 5% of current value on each win, clamped to [3.2, 4.8]
    const currentRep = currentAgent.reputation || 3.8;
    const maxDelta = currentRep * 0.05;
    const delta = (Math.random() * 2 - 1) * maxDelta; // random between -maxDelta and +maxDelta
    const newReputation = Math.round(Math.max(3.2, Math.min(4.8, currentRep + delta)) * 1000) / 1000;

    await supabase.from('agents').update({
      balance: newBalance,
      total_revenue: newRevenue,
      tasks_completed: newTasksCompleted,
      reputation: newReputation,
    }).eq('id', agent.id);

    agent.balance = newBalance;

    // === LOG ECONOMY EVENTS (always) ===
    const paymentRecord = createPaymentRecord(
      'operator', agent.id, COST_SINK_WALLET, agent.wallet_address,
      'task_payment', revenue, { taskId: task.id, taskType: task.type }
    );

    createEvent({
      event_type: 'task_payment',
      description: `Operator paid ${agent.name} $${revenue} USDC for task ${task.type}`,
      agent_wallets: [agent.wallet_address],
      amount: revenue,
      tx_hash: x402TxHash || null,
      metadata: {
        task_id: task.id, task_type: task.type, bid_amount: revenue, bid_id: winningBid.id,
        operational_cost: operationalCost, gross_profit: grossProfit,
        overhead, net_profit: netProfit,
        platform_cut: platformCut, remaining_profit: remainingProfit,
        agent_share: agentShare, investor_share: investorShareTotal,
        investor_share_bps: investorShareBps, payment_id: paymentRecord.id,
        x402_tx_hash: x402TxHash, cost_tx_hash: costTxHash, currency: 'USDC',
      },
    }).catch(err => console.error('[EconomyService] task_payment event error:', err));

    createEvent({
      event_type: 'cost_sink_payment',
      description: `${agent.name} paid $${operationalCost} USDC operational cost to sink`,
      agent_wallets: [agent.wallet_address],
      amount: operationalCost,
      tx_hash: costTxHash || null,
      metadata: {
        task_id: task.id, task_type: task.type, operational_cost: operationalCost,
        cost_sink_wallet: COST_SINK_WALLET, currency: 'USDC', tx_hash: costTxHash || null,
      },
    }).catch(err => console.error('[EconomyService] cost_sink_payment event error:', err));

    if (platformCut > 0) {
      createEvent({
        event_type: 'platform_profit_share',
        description: `${agent.name} paid $${platformCut.toFixed(6)} USDC platform profit share (${(platformPct * 100).toFixed(0)}%)`,
        agent_wallets: [agent.wallet_address],
        amount: platformCut,
        tx_hash: platformCutTxHash || null,
        metadata: {
          task_id: task.id, task_type: task.type, net_profit: netProfit,
          platform_pct: platformPct, platform_cut: platformCut,
          cost_sink_wallet: COST_SINK_WALLET, currency: 'USDC', tx_hash: platformCutTxHash,
        },
      }).catch(err => console.error('[EconomyService] platform_profit_share event error:', err));
    }

    if (investorShareTotal > 0) {
      createEvent({
        event_type: 'escrow_deposit',
        description: `${agent.name} escrowed $${investorShareTotal.toFixed(6)} USDC for ${holderCount} investors`,
        agent_wallets: [agent.wallet_address],
        amount: investorShareTotal,
        tx_hash: escrowTxHash || null,
        metadata: {
          task_id: task.id, task_type: task.type, gross_profit: grossProfit,
          overhead, net_profit: netProfit,
          investor_share_total: investorShareTotal, agent_share: agentShare,
          investor_share_bps: investorShareBps, holder_count: holderCount,
          escrow_wallet: ESCROW_WALLET, currency: 'USDC', tx_hash: escrowTxHash,
        },
      }).catch(err => console.error('[EconomyService] escrow_deposit event error:', err));
    }

    console.log(
      `[EconomyService] ${agent.name} | rev: $${revenue.toFixed(4)} | cost: $${operationalCost.toFixed(4)} | ` +
      `gross: $${grossProfit.toFixed(4)} | overhead: $${overhead.toFixed(4)} | net: $${netProfit.toFixed(4)} | ` +
      `platform ${(platformPct * 100).toFixed(0)}%: $${platformCut.toFixed(4)} | ` +
      `investor ${(investorPct * 100).toFixed(0)}%: $${investorShareTotal.toFixed(4)} | agent: $${agentShare.toFixed(4)}`
    );

    return {
      revenue,
      cost: operationalCost,
      profit: agentShare,
      newBalance,
      reputationChange: Math.round(delta * 1000) / 1000,
      blockchainPayment: {
        x402TxHash,
        costTxHash,
        platformCutTxHash,
        escrowTxHash,
        investorShareTotal,
        platformCut,
        agentShare,
        holderCount,
      },
    };
  }

  /**
   * Deduct living costs from all agents.
   * When useBlockchain=true, sends real USDC to cost sink and records tx_hash.
   */
  async deductLivingCosts(
    agents: AgentWithPolicy[],
    costPerRound: number,
    roundNum: number,
    options?: { useBlockchain?: boolean }
  ): Promise<void> {
    const useBlockchain = options?.useBlockchain ?? true;

    for (const agent of agents) {
      if (agent.balance <= 0) continue;

      let txHash: string | undefined;

      if (useBlockchain) {
        // Real USDC transfer to cost sink
        const { data: agentData } = await supabase
          .from('agents')
          .select('privy_wallet_id')
          .eq('id', agent.id)
          .single();

        if (agentData?.privy_wallet_id) {
          try {
            const result = await payOperationalCostToSink(agentData.privy_wallet_id, costPerRound);
            txHash = result.transaction_hash;
          } catch (err) {
            console.warn(`[EconomyService] Living cost blockchain payment failed for ${agent.name}:`, err);
            await logSystemError('blockchain', err, {
              round_number: roundNum,
              agent_name: agent.name,
              agent_id: agent.id,
              detail: `Living cost payment failed ($${costPerRound})`,
            });
          }
        }
      }

      const newBalance = Math.max(0, agent.balance - costPerRound);

      await supabase
        .from('agents')
        .update({ balance: newBalance })
        .eq('id', agent.id);

      // Update local copy
      agent.balance = newBalance;

      // Record living cost event
      createEvent({
        event_type: 'living_cost',
        description: `${agent.name} living cost for round ${roundNum}`,
        agent_wallets: [agent.wallet_address],
        amount: costPerRound,
        tx_hash: txHash || null,
        metadata: {
          round: roundNum,
          agent_name: agent.name,
          cost_type: 'infrastructure',
          balance_after: newBalance,
          tx_hash: txHash,
        },
      }).catch(() => {});
    }
  }

  /**
   * Update agent reputation
   */
  async updateReputation(
    agentId: string,
    change: number,
    _reason: string
  ): Promise<number> {
    const { data: agent, error: getError } = await supabase
      .from('agents')
      .select('reputation')
      .eq('id', agentId)
      .single();

    if (getError || !agent) {
      return 0;
    }

    const newReputation = Math.max(0, Math.min(1000, (agent.reputation || 500) + change));

    await supabase
      .from('agents')
      .update({ reputation: newReputation })
      .eq('id', agentId);

    return newReputation;
  }

  /**
   * Record an economy event
   */
  async recordEconomyEvent(event: EconomyEventInput): Promise<void> {
    const result = await createEvent({
      event_type: event.event_type,
      description: event.description,
      agent_wallets: event.agent_wallets,
      investor_wallet: event.investor_wallet,
      amount: event.amount,
      metadata: event.metadata,
    });

    if (result.error) {
      console.error('[EconomyService] Failed to record event:', result.error);
    }
  }

  /**
   * Adjust agent balance by a delta amount
   */
  async adjustBalance(agentId: string, delta: number): Promise<number> {
    const { data: agent, error: getError } = await supabase
      .from('agents')
      .select('balance')
      .eq('id', agentId)
      .single();

    if (getError || !agent) {
      console.error('[EconomyService] Failed to get agent balance:', getError);
      return 0;
    }

    const newBalance = Math.max(0, (agent.balance || 0) + delta);

    const { error: updateError } = await supabase
      .from('agents')
      .update({ balance: newBalance })
      .eq('id', agentId);

    if (updateError) {
      console.error('[EconomyService] Failed to adjust balance:', updateError);
      return agent.balance || 0;
    }

    return newBalance;
  }

  /**
   * Create an agent-specific economy event
   */
  async createAgentEvent(
    eventType: string,
    description: string,
    agentId: string,
    amount?: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const { data: agentData } = await supabase
      .from('agents')
      .select('wallet_address')
      .eq('id', agentId)
      .single();

    if (!agentData) {
      console.error('[EconomyService] Agent not found for event:', agentId);
      return;
    }

    await this.recordEconomyEvent({
      event_type: eventType,
      description,
      agent_wallets: [agentData.wallet_address],
      amount: amount ?? null,
      metadata: metadata || {},
    });
  }

  /**
   * Check and update agent lifecycle status.
   * Returns status change info if changed, null if unchanged.
   */
  async checkAndUpdateLifecycle(
    agent: AgentWithPolicy
  ): Promise<{ changed: boolean; from: string; to: string } | null> {
    const agentCosts = agent.costs || AGENT_COSTS[agent.type] || AGENT_COSTS.CATALOG;

    // Get current status from DB
    const { data: currentAgent } = await supabase
      .from('agents')
      .select('status')
      .eq('id', agent.id)
      .single();

    if (!currentAgent) return null;

    const currentStatus = currentAgent.status as AgentStatus;
    const newStatus = evaluateLifecycleStatus(currentStatus, agent.balance, agentCosts);

    if (newStatus !== currentStatus) {
      await this.updateAgentStatus(agent.id, newStatus);

      if (newStatus === AgentStatus.DEAD) {
        await this.createAgentEvent(
          'agent_death',
          `${agent.name} has died (balance depleted)`,
          agent.id,
          0
        );
      }

      return { changed: true, from: currentStatus, to: newStatus };
    }

    return null;
  }

  /**
   * Update agent status
   */
  async updateAgentStatus(agentId: string, status: string): Promise<void> {
    const { error } = await supabase
      .from('agents')
      .update({ status })
      .eq('id', agentId);

    if (error) {
      console.error('[EconomyService] Failed to update agent status:', error);
    }
  }
}

// Singleton instance for convenience
export const economyService = new EconomyService();
