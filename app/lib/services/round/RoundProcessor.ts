/**
 * RoundProcessor - Single pipeline for all agent round processing
 *
 * Both simulation and runtime call this same function.
 * The only differences are controlled by config flags:
 * - useBlockchain: real USDC transfers vs DB-only
 * - useLLM: real Gemini brain vs defaults/skip
 */

import { agentService } from '../agent/AgentService';
import { auctionService } from '../auction/AuctionService';
import { biddingService } from '../bidding/BiddingService';
import { economyService } from '../economy/EconomyService';
import { brainService } from '../brain/BrainService';
import { memoryService } from '../memory/MemoryService';
import { taskService } from '../task/TaskService';
import { recordBidResult, loadRuntimeState, saveRuntimeState, initializeRuntimeState } from '@/lib/agent-runtime/state';
import { createEvent, logSystemError } from '@/lib/api-helpers';
import { AGENT_COSTS } from '@/lib/agent-runtime/constants';
import { supabase } from '@/lib/supabase';
import type { AgentCostStructure } from '@/lib/agent-runtime/types';
import type { AgentWithPolicy, Task, RoundConfig, RoundProcessorResult } from '../types';
import { buildBiddingDiagnostics, enrichWithAuctionResults, logDiagnostics } from './round-diagnostics';
import type { RoundDiagnostics } from './round-diagnostics';
import { executeBuyback } from '@/lib/platform-buyback';
import { PLATFORM_TOKEN_ADDRESS, BUYBACK_MIN_MON } from '@/lib/platform-config';

export class RoundProcessor {
  /**
   * Process a single round for the given tasks and agents.
   *
   * Pipeline:
   * 1. Lifecycle checks
   * 2. Bidding (with bid cost)
   * 3. Auction closure + Task execution
   * 4. Runtime state tracking (win/loss for exception detection)
   * 5. Living costs
   * 6. Exception detection + Brain wake-ups
   * 7. QBR (if due and useLLM)
   * 8. Memory creation (integrated in steps above, fire-and-forget)
   * 9. Capture final agent states
   */
  async processRound(
    tasks: Task[],
    agents: AgentWithPolicy[],
    config: RoundConfig
  ): Promise<RoundProcessorResult> {
    const { useBlockchain, useLLM, roundNumber, livingCostPerRound } = config;
    const result: RoundProcessorResult = {
      round: roundNumber,
      tasksProcessed: tasks.length,
      bidsPlaced: 0,
      auctionsClosed: 0,
      tasksCompleted: 0,
      tasksExpired: 0,
      totalRevenue: 0,
      livingCostsDeducted: 0,
      exceptionsDetected: 0,
      brainWakeups: [],
      qbrsRun: 0,
      lifecycleChanges: [],
      agentStates: [],
    };

    console.log(`[RoundProcessor] === Round ${roundNumber} === (${tasks.length} tasks, ${agents.length} agents, blockchain=${useBlockchain}, llm=${useLLM})`);

    // ---------------------------------------------------------------
    // Step 0: Stamp tasks with round_number (persists which round each task belongs to)
    // ---------------------------------------------------------------
    const taskIds = tasks.map(t => t.id);
    if (taskIds.length > 0) {
      const { error: stampError } = await supabase
        .from('tasks')
        .update({ round_number: roundNumber })
        .in('id', taskIds);
      if (stampError) {
        console.error(`[RoundProcessor] Failed to stamp round_number:`, stampError);
      }
    }

    // ---------------------------------------------------------------
    // Step 1: Lifecycle checks - remove DEAD agents from processing
    // ---------------------------------------------------------------
    const lifecycleResults = await Promise.all(
      agents.map(async (agent) => {
        const lifecycle = await economyService.checkAndUpdateLifecycle(agent);
        return { agent, lifecycle };
      })
    );
    const activeAgents: AgentWithPolicy[] = [];
    for (const { agent, lifecycle } of lifecycleResults) {
      if (lifecycle?.changed) {
        result.lifecycleChanges.push({
          agentId: agent.id, from: lifecycle.from, to: lifecycle.to,
        });
        console.log(`[RoundProcessor] ${agent.name}: ${lifecycle.from} -> ${lifecycle.to}`);
        if (lifecycle.to === 'DEAD') continue;
      }
      activeAgents.push(agent);
    }

    // ---------------------------------------------------------------
    // Step 2: Bidding - generate bids with cost deduction
    // ---------------------------------------------------------------
    const { bids, skipped } = biddingService.generateBidsForRound(tasks, activeAgents);
    // Stamp round_number on each bid for consistent round-based queries
    for (const bid of bids) { bid.roundNumber = roundNumber; }
    console.log(`[RoundProcessor] Generated ${bids.length} bids (${skipped.length} skipped)`);

    // Build agent costs map for batch bid submission
    const agentCostsMap = new Map<string, AgentCostStructure>();
    for (const agent of activeAgents) {
      agentCostsMap.set(agent.id, agent.costs || AGENT_COSTS[agent.type] || AGENT_COSTS.CATALOG);
    }

    // Submit bids (with bid cost deduction inside AuctionService)
    const submittedBids = await auctionService.submitBatchBids(bids, agentCostsMap);
    result.bidsPlaced = submittedBids.length;

    // Fire-and-forget: Create bid_placed events (bid memories created in step 4b after outcome known)
    for (const bid of bids) {
      const agent = activeAgents.find(a => a.id === bid.agentId);
      if (agent) {
        const task = tasks.find(t => t.id === bid.taskId);
        createEvent({
          event_type: 'bid_placed',
          description: `${agent.name} bid $${bid.amount.toFixed(4)} on ${task?.type || 'UNKNOWN'}`,
          agent_wallets: [agent.wallet_address],
          amount: bid.amount,
          round_number: roundNumber,
          metadata: {
            task_id: bid.taskId,
            task_type: task?.type || 'UNKNOWN',
            agent_name: agent.name,
            margin: bid.policyUsed?.margin,
          },
        }).catch(() => {});
      }
    }

    // ---------------------------------------------------------------
    // Diagnostics: capture bidding phase data
    // ---------------------------------------------------------------
    let diagnostics: RoundDiagnostics | null = null;
    try {
      diagnostics = buildBiddingDiagnostics(roundNumber, activeAgents, bids, tasks);
    } catch (err) {
      console.error(`[RoundProcessor] Diagnostics build error:`, err);
    }

    // ---------------------------------------------------------------
    // Step 3: Auction closure + Task delivery (via x402 endpoint)
    // All tasks processed in parallel — each agent bids on at most
    // one task per round, so auctions are fully independent.
    // ---------------------------------------------------------------
    // Track winners: taskId -> { agentId, revenue }
    const taskWinners = new Map<string, { agentId: string; revenue: number }>();
    // Track full auction results for bid memory updates
    const auctionResults: Array<{ task: Task; winningBid: { id: string; amount: number; agent_id: string }; winnerName: string; losingBids: Array<{ agent_id: string; amount: number }> }> = [];
    const apiBase = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4000';

    if (!config.payingFetch) {
      throw new Error('payingFetch is required — use createServerPayingFetch() from agent-client.ts');
    }
    const payFetch = config.payingFetch;

    const taskResults = await Promise.allSettled(tasks.map(async (task) => {
      const auctionResult = await auctionService.closeAuction(task, activeAgents);

      if (!auctionResult) {
        await taskService.expireTask(task.id);
        return { task, status: 'expired' as const };
      }

      const auctionData = {
        task,
        winningBid: { id: auctionResult.winningBid.id, amount: auctionResult.winningBid.amount, agent_id: auctionResult.winningBid.agent_id },
        winnerName: auctionResult.agent.name,
        losingBids: (auctionResult.losingBids || []).map(b => ({ agent_id: b.agent_id, amount: b.amount })),
      };

      try {
        const deliveryRes = await payFetch(`${apiBase}/api/task-delivery/${task.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (deliveryRes.ok) {
          const deliveryData = await deliveryRes.json();
          const revenue = deliveryData.bidAmount || auctionResult.revenue;
          const profit = deliveryData.netProfit || 0;
          const platformCut = deliveryData.platformCut || 0;

          const x402Tx = deliveryData.x402TxHash ? ` [x402: ${deliveryData.x402TxHash.slice(0, 10)}...]` : '';
          const costTx = deliveryData.costTxHash ? ` [cost: ${deliveryData.costTxHash.slice(0, 10)}...]` : '';
          console.log(`[RoundProcessor] ${auctionResult.agent.name} completed ${task.type}: bid=$${revenue.toFixed(4)}, profit=$${profit.toFixed(4)}${x402Tx}${costTx}`);

          // Fire-and-forget: Create task execution memory
          memoryService.createTaskExecutionMemory(
            auctionResult.agent.id, task.id, task.type,
            revenue, deliveryData.operationalCost || 0, roundNumber, auctionResult.agent
          ).catch(err => console.error(`[RoundProcessor] Task memory error:`, err));

          return { task, status: 'completed' as const, auctionData, agentId: auctionResult.agent.id, revenue, platformCut };
        } else {
          const errorText = await deliveryRes.text().catch(() => 'unknown');
          console.warn(`[RoundProcessor] Task delivery failed for ${task.id} (${deliveryRes.status}): ${errorText.slice(0, 200)}`);
          await logSystemError('payment', new Error(`HTTP ${deliveryRes.status}: ${errorText.slice(0, 200)}`), {
            round_number: roundNumber,
            agent_name: auctionResult.agent.name,
            agent_id: auctionResult.agent.id,
            detail: `Task delivery failed for task ${task.id} (${task.type})`,
          });
          return { task, status: 'failed' as const, auctionData };
        }
      } catch (err) {
        console.error(`[RoundProcessor] Task delivery error for ${task.id}:`, err);
        await logSystemError('payment', err, {
          round_number: roundNumber,
          agent_name: auctionResult.agent.name,
          agent_id: auctionResult.agent.id,
          detail: `Task delivery failed for task ${task.id} (${task.type})`,
        });
        return { task, status: 'failed' as const, auctionData };
      }
    }));

    // Aggregate parallel results
    let totalPlatformCut = 0;
    for (const settled of taskResults) {
      if (settled.status === 'rejected') {
        console.error(`[RoundProcessor] Task processing error:`, settled.reason);
        await logSystemError('blockchain', settled.reason, {
          round_number: roundNumber,
          detail: 'Task processing promise rejected',
        });
        result.tasksExpired++;
        continue;
      }
      const tr = settled.value;
      if (tr.status === 'expired') {
        result.tasksExpired++;
      } else if (tr.status === 'completed') {
        result.auctionsClosed++;
        result.tasksCompleted++;
        result.totalRevenue += tr.revenue;
        totalPlatformCut += tr.platformCut || 0;
        taskWinners.set(tr.task.id, { agentId: tr.agentId, revenue: tr.revenue });
        auctionResults.push(tr.auctionData);
      } else {
        // failed delivery
        result.auctionsClosed++;
        result.tasksExpired++;
        auctionResults.push(tr.auctionData!);
      }
    }

    // ---------------------------------------------------------------
    // Diagnostics: enrich with auction results and log
    // ---------------------------------------------------------------
    if (diagnostics && auctionResults.length > 0) {
      try {
        enrichWithAuctionResults(diagnostics, auctionResults, activeAgents);
        logDiagnostics(diagnostics);
      } catch (err) {
        console.error(`[RoundProcessor] Diagnostics enrichment error:`, err);
      }
    }

    // ---------------------------------------------------------------
    // Step 4: Runtime state tracking (win/loss for exception detection)
    // All per-agent DB writes run in parallel.
    // ---------------------------------------------------------------
    await Promise.all(
      bids.map(async (bid) => {
        const winner = taskWinners.get(bid.taskId);
        const won = winner?.agentId === bid.agentId;
        try {
          await recordBidResult(bid.agentId, won, bid.amount, won ? winner!.revenue : 0);
        } catch (err) {
          console.error(`[RoundProcessor] Failed to record bid result for ${bid.agentId}:`, err);
        }
      })
    );

    // Update current_round for all active agents (parallel)
    // NOTE: Do NOT reset reputation_at_last_check here — it should only be
    // updated when the brain wakes up (in BrainService), so the reputation_drop
    // exception detection can measure cumulative drops across multiple rounds.
    await Promise.all(
      activeAgents.map(async (agent) => {
        try {
          let state = await loadRuntimeState(agent.id);
          if (!state) {
            state = await initializeRuntimeState(agent.id);
          }
          state.current_round = roundNumber;
          state.is_running = true;
          state.last_active_at = new Date().toISOString();
          // reputation_at_last_check intentionally NOT reset here
          await saveRuntimeState(state);
        } catch (err) {
          console.error(`[RoundProcessor] Failed to update runtime state for ${agent.name}:`, err);
        }
      })
    );

    console.log(`[RoundProcessor] Updated runtime state: ${taskWinners.size} winners, ${bids.length - taskWinners.size} losers`);

    // ---------------------------------------------------------------
    // Step 4b: Create bid outcome memories (won/lost + competitor data)
    // Created here (not at bid time) to avoid race condition with async LLM narrative
    // ---------------------------------------------------------------
    for (const ar of auctionResults) {
      // Winner's bid memory
      const winAgent = activeAgents.find(a => a.id === ar.winningBid.agent_id);
      if (winAgent) {
        memoryService.createBidOutcomeMemory(
          ar.winningBid.agent_id, ar.task.id, ar.task.type,
          true, ar.winningBid.amount, roundNumber, winAgent,
        ).catch(err => console.error(`[RoundProcessor] Bid memory (win) error:`, err));
      }

      // Loser bid memories with winner context
      for (const loser of ar.losingBids) {
        const loserAgent = activeAgents.find(a => a.id === loser.agent_id);
        if (loserAgent) {
          memoryService.createBidOutcomeMemory(
            loser.agent_id, ar.task.id, ar.task.type,
            false, loser.amount, roundNumber, loserAgent,
            ar.winningBid.amount, ar.winnerName, ar.winningBid.agent_id,
          ).catch(err => console.error(`[RoundProcessor] Bid memory (loss) error:`, err));
        }
      }
    }

    // ---------------------------------------------------------------
    // Step 5: Living costs
    // ---------------------------------------------------------------
    await economyService.deductLivingCosts(activeAgents, livingCostPerRound, roundNumber, { useBlockchain });
    result.livingCostsDeducted = activeAgents.length * livingCostPerRound;

    // ---------------------------------------------------------------
    // Step 6: Exception detection (fast, awaited) + Brain execution (fire-and-forget)
    // Detection is just DB reads — we need the count for predictions.
    // LLM execution is slow — don't block the round.
    // ---------------------------------------------------------------
    const detected = await brainService.detectExceptions(activeAgents, roundNumber, 3);
    result.exceptionsDetected = detected.length;
    // Build lightweight wakeup entries so result.brainWakeups has data immediately
    result.brainWakeups = detected.map(d => ({
      agentId: d.agent.id,
      agentName: d.agent.name,
      round: roundNumber,
      exceptionType: d.exception.type,
      details: JSON.stringify(d.exception.details),
      policyChanges: {},
      reasoning: 'Brain wakeup triggered (executing in background)',
    }));
    console.log(`[RoundProcessor] Detected ${detected.length} exceptions, triggering brain wakeups in background`);

    // Fire-and-forget: actual LLM calls + memory creation
    if (detected.length > 0) {
      brainService.executeWakeups(detected, roundNumber, useLLM).then(wakeups => {
        for (const wakeup of wakeups) {
          const agent = activeAgents.find(a => a.id === wakeup.agentId);
          if (agent) {
            memoryService.createExceptionMemory(
              wakeup.agentId, wakeup.exceptionType, wakeup.details || '',
              true, roundNumber, agent
            ).catch(err => console.error(`[RoundProcessor] Exception memory error:`, err));
          }
        }
        console.log(`[RoundProcessor] Round ${roundNumber} background: ${wakeups.length} brain wakeups completed`);
      }).catch(err => console.error(`[RoundProcessor] Brain execution error:`, err));
    }

    // ---------------------------------------------------------------
    // Step 7: QBR (if due) — fire-and-forget, runs in background
    // ---------------------------------------------------------------
    Promise.allSettled(
      activeAgents.map(async (agent) => {
        const qbrRan = await brainService.checkAndRunQBR(agent, roundNumber, useLLM);
        if (qbrRan) {
          memoryService.createQBRMemory(
            agent.id, 'scheduled', roundNumber, agent
          ).catch(err => console.error(`[RoundProcessor] QBR memory error:`, err));
        }
        return qbrRan;
      })
    ).then(qbrResults => {
      let qbrsRun = 0;
      for (const r of qbrResults) {
        if (r.status === 'fulfilled' && r.value) qbrsRun++;
      }
      result.qbrsRun = qbrsRun;
      if (qbrsRun > 0) {
        console.log(`[RoundProcessor] Round ${roundNumber} background: ${qbrsRun} QBRs completed`);
      }
    }).catch(err => console.error(`[RoundProcessor] QBR error:`, err));

    // ---------------------------------------------------------------
    // Step 8: Platform buyback & burn (fire-and-forget)
    // Use accumulated platform cut (USDC) as MON-equivalent for buyback.
    // Only runs if PLATFORM_TOKEN_ADDRESS is configured and amount exceeds minimum.
    // ---------------------------------------------------------------
    if (totalPlatformCut > 0 && PLATFORM_TOKEN_ADDRESS) {
      // Convert USDC platform cut to MON (1 MON = $0.02 USDC)
      const USDC_PER_MON = 0.02;
      const buybackMonNum = totalPlatformCut / USDC_PER_MON;
      const buybackMon = buybackMonNum.toFixed(6);
      if (parseFloat(buybackMon) >= parseFloat(BUYBACK_MIN_MON)) {
        console.log(`[RoundProcessor] Triggering INOMY buyback & burn: ${buybackMon} MON (from $${totalPlatformCut.toFixed(6)} USDC platform cut)`);
        executeBuyback(buybackMon).then(buybackResult => {
          if (buybackResult.success) {
            console.log(`[RoundProcessor] Buyback success: spent ${buybackResult.monSpent} MON, burned ~${buybackResult.tokensBurned} INOMY [tx: ${buybackResult.txHash.slice(0, 14)}...]`);
          } else {
            console.warn(`[RoundProcessor] Buyback failed: ${buybackResult.error}`);
          }
        }).catch(err => {
          console.error(`[RoundProcessor] Buyback error:`, err instanceof Error ? err.message : err);
        });
      } else {
        console.log(`[RoundProcessor] Platform cut $${totalPlatformCut.toFixed(6)} below buyback minimum (${BUYBACK_MIN_MON} MON), skipping`);
      }
    }

    // ---------------------------------------------------------------
    // Step 9: Capture final agent states
    // ---------------------------------------------------------------
    const refreshedAgents = await agentService.refreshAgentData(activeAgents);
    result.agentStates = refreshedAgents.map(a => ({
      id: a.id, name: a.name, balance: a.balance, reputation: a.reputation,
      status: 'ACTIVE',
    }));

    console.log(`[RoundProcessor] Round ${roundNumber} complete: ${result.tasksCompleted}/${result.tasksProcessed} tasks, $${result.totalRevenue.toFixed(4)} revenue, ${result.brainWakeups.length} wakeups`);

    return result;
  }
}

export const roundProcessor = new RoundProcessor();
