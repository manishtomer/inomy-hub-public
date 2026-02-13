/**
 * POST /api/arena/run
 *
 * Run N rounds (1-10). Acquires lock, reuses RoundProcessor,
 * saves snapshots, checks season boundary.
 *
 * Body: { rounds?: number (1-10), tasks_per_round?: number, holder: string }
 * Requires connected wallet. Each wallet limited to 50 rounds/24h.
 */

import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { agentService } from '@/lib/services/agent/AgentService';
import { TaskService } from '@/lib/services/task/TaskService';
import { roundProcessor } from '@/lib/services/round/RoundProcessor';
import { arenaService } from '@/lib/services/arena/ArenaService';
import { createServerPayingFetch } from '@/lib/agent-client';
import { createEvent } from '@/lib/api-helpers';
import { fantasyTournamentService } from '@/lib/services/tournaments/FantasyTournamentService';
import { checkQuota, recordUsage } from '@/lib/services/round-quota';
import type { RoundConfig, RoundProcessorResult } from '@/lib/services/types';

const DEFAULT_TASKS_PER_ROUND = 3;
const MAX_ROUNDS = 10;
const LIVING_COST_PER_ROUND = 0.005;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const rounds = Math.min(Math.max(body.rounds || 1, 1), MAX_ROUNDS);
  const tasksPerRound = body.tasks_per_round || body.tasksPerRound || DEFAULT_TASKS_PER_ROUND;
  const holder = body.holder;

  // 0a. Require wallet
  if (!holder || holder === 'anonymous') {
    return NextResponse.json(
      { success: false, error: 'Connect your wallet to run rounds' },
      { status: 401 }
    );
  }

  // 0b. Check daily quota
  const quota = await checkQuota(holder);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: `Daily limit reached (${quota.limit} rounds per 24h). Try again later.`,
        quota: { used: quota.used, remaining: quota.remaining, limit: quota.limit },
      },
      { status: 429 }
    );
  }

  // 1. Acquire lock
  const locked = await arenaService.acquireLock(holder);
  if (!locked) {
    return NextResponse.json(
      { success: false, error: 'Arena is locked — another round is in progress' },
      { status: 409 }
    );
  }

  try {
    // 2. Get current round
    const { data: roundState } = await supabase
      .from('simulation_state')
      .select('current_round')
      .eq('id', 'global')
      .single();
    const startingRound = (roundState?.current_round || 0) + 1;

    // 3. Ensure active season
    const season = await arenaService.ensureActiveSeason(startingRound - 1);

    // 4. Load agents
    let agents = await agentService.getActiveAgents();
    if (agents.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No active agents found' },
        { status: 400 }
      );
    }

    console.log(`[Arena] Running ${rounds} round(s) starting at ${startingRound}, season ${season.seasonNumber}, ${agents.length} agents, holder=${holder}`);

    // 4a. Emit round_started event for admin visibility
    await createEvent({
      event_type: 'round_started',
      description: `${holder === 'anonymous' ? 'Anonymous' : holder.slice(0, 6) + '...' + holder.slice(-4)} started ${rounds} round(s) from round ${startingRound}`,
      round_number: startingRound,
      metadata: {
        holder,
        rounds_requested: rounds,
        tasks_per_round: tasksPerRound,
        agent_count: agents.length,
        season_id: season.id,
        season_number: season.seasonNumber,
      },
    });

    // 4b. Top up agent wallets with MON gas (best-effort, don't block on failure)
    try {
      const agentWallets = agents
        .map(a => a.wallet_address)
        .filter((w): w is string => !!w);
      if (agentWallets.length > 0) {
        const origin = request.nextUrl.origin;
        const topupRes = await fetch(`${origin}/api/gas-topup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallets: agentWallets }),
        });
        const topupJson = await topupRes.json();
        if (topupJson.success && topupJson.data.topped_up > 0) {
          console.log(`[Arena] Topped up ${topupJson.data.topped_up} agent(s) with MON gas`);
        }
      }
    } catch (err) {
      console.error('[Arena] Agent gas top-up failed (non-blocking):', err);
    }

    // 4c. Top up operator wallet with USDC if low (best-effort)
    try {
      const origin = request.nextUrl.origin;
      const opTopup = await fetch(`${origin}/api/operator-topup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold: 5, amount: 50 }),
      });
      const opJson = await opTopup.json();
      if (opJson.success && opJson.data?.action === 'refilled') {
        console.log(`[Arena] Operator USDC refilled: ${opJson.data.operator_balance_before.toFixed(2)} -> ${opJson.data.operator_balance_after.toFixed(2)} (tx: ${opJson.data.tx_hash?.slice(0, 14)}...)`);
      }
    } catch (err) {
      console.error('[Arena] Operator USDC top-up failed (non-blocking):', err);
    }

    // 5. Create paying fetch
    const payingFetch = createServerPayingFetch();
    const localTaskService = new TaskService();
    const roundResults: RoundProcessorResult[] = [];
    let currentSeason = season;

    // 6. Process rounds
    for (let i = 0; i < rounds; i++) {
      const roundNum = startingRound + i;

      // Generate synthetic tasks
      const taskInputs = TaskService.generateRandomTaskInputs(tasksPerRound);
      const tasks = await localTaskService.createBatchTasks(taskInputs);

      // Run the round
      const config: RoundConfig = {
        useBlockchain: true,
        useLLM: true,
        roundNumber: roundNum,
        livingCostPerRound: LIVING_COST_PER_ROUND,
        payingFetch,
      };
      const result = await roundProcessor.processRound(tasks, agents, config);
      roundResults.push(result);

      // Save snapshot
      const snapshotAgents = result.agentStates.map(a => ({
        id: a.id,
        balance: a.balance,
        reputation: a.reputation,
        status: a.status,
      }));
      await arenaService.saveRoundSnapshot(roundNum, currentSeason.id, snapshotAgents);

      // Emit round_complete event
      await createEvent({
        event_type: 'round_complete',
        description: `Round ${roundNum}: ${result.tasksCompleted}/${result.tasksProcessed} tasks completed, $${result.totalRevenue.toFixed(4)} revenue`,
        amount: result.totalRevenue,
        round_number: roundNum,
        metadata: {
          holder,
          agent_count: agents.length,
          tasks_processed: result.tasksProcessed,
          tasks_completed: result.tasksCompleted,
          bids_placed: result.bidsPlaced,
          brain_wakeups: result.brainWakeups.length,
          season_id: currentSeason.id,
          season_number: currentSeason.seasonNumber,
        },
      });

      // Check fantasy tournaments
      await fantasyTournamentService.onRoundComplete(roundNum);

      // Check season boundary
      if (arenaService.isSeasonBoundary(roundNum, currentSeason)) {
        console.log(`[Arena] Season ${currentSeason.seasonNumber} complete at round ${roundNum}`);
        await arenaService.finalizeSeason(currentSeason.id, roundNum);

        // Start new season if more rounds remain
        if (i < rounds - 1) {
          currentSeason = await arenaService.ensureActiveSeason(roundNum);
        }
      }

      // Refresh agents for next round
      agents = await agentService.refreshAgentData(agents);
    }

    // 6b. Record quota usage
    await recordUsage(holder, rounds);

    // 7. Update leaderboard for live standings
    await arenaService.computeLeaderboard(currentSeason.id);

    // 7b. Trigger chain sync to pick up on-chain events (x402 payments, token trades, etc.)
    try {
      const origin = request.nextUrl.origin;
      fetch(`${origin}/api/sync/trigger`, { method: 'POST' }).catch(() => {});
    } catch { /* best-effort */ }

    // 8. Update round counter
    const endingRound = startingRound + rounds - 1;
    await supabase.from('simulation_state').upsert({
      id: 'global',
      current_round: endingRound,
      updated_at: new Date().toISOString(),
    });

    // 9. Aggregate results
    const totals = roundResults.reduce((acc, r) => ({
      tasks: acc.tasks + r.tasksProcessed,
      bids: acc.bids + r.bidsPlaced,
      completed: acc.completed + r.tasksCompleted,
      revenue: acc.revenue + r.totalRevenue,
      wakeups: acc.wakeups + r.brainWakeups.length,
    }), { tasks: 0, bids: 0, completed: 0, revenue: 0, wakeups: 0 });

    console.log(`[Arena] Completed ${rounds} rounds: ${totals.completed}/${totals.tasks} tasks, ${totals.wakeups} wakeups`);

    return NextResponse.json({
      success: true,
      data: {
        rounds_completed: rounds,
        starting_round: startingRound,
        ending_round: endingRound,
        season: {
          id: currentSeason.id,
          number: currentSeason.seasonNumber,
          roundsCompleted: currentSeason.roundsCompleted + rounds,
          roundsTotal: currentSeason.roundsTotal,
        },
        totals,
        rounds: roundResults.map(r => ({
          round: r.round,
          tasksProcessed: r.tasksProcessed,
          bidsPlaced: r.bidsPlaced,
          tasksCompleted: r.tasksCompleted,
          totalRevenue: r.totalRevenue,
          brainWakeups: r.brainWakeups.length,
          agentStates: r.agentStates,
        })),
      },
    });
  } catch (error) {
    console.error('[Arena/run] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  } finally {
    // 10. Always release lock
    await arenaService.releaseLock();
  }
}
