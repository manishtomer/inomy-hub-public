/**
 * POST /api/admin/simulate-v2
 *
 * Thin simulation driver. Generates synthetic tasks, then delegates
 * all business logic to the shared RoundProcessor pipeline.
 */

import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { agentService, TaskService, roundProcessor } from '@/lib/services';
import { createServerPayingFetch } from '@/lib/agent-client';
import type { RoundConfig, RoundProcessorResult } from '@/lib/services/types';

const DEFAULT_TASKS_PER_ROUND = 3;
const DEFAULT_ROUNDS = 1;
const LIVING_COST_PER_ROUND = 0.005;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const tasksPerRound = body.tasks_per_round || body.tasksPerRound || DEFAULT_TASKS_PER_ROUND;
    const rounds = body.rounds || DEFAULT_ROUNDS;
    const priceMin = body.price_min || body.priceMin || 0.05;
    const priceMax = body.price_max || body.priceMax || 0.10;
    const useBlockchain = body.use_blockchain ?? body.useBlockchain ?? true;
    const useLLM = body.use_llm ?? body.useLLM ?? true;
    const agentIds: string[] | undefined = body.agent_ids || body.agentIds;
    const agentCount: number | undefined = body.agent_count || body.agentCount;

    console.log(`[Simulate-v2] Starting ${rounds} round(s) with ${tasksPerRound} tasks each (blockchain: ${useBlockchain}, llm: ${useLLM})`);

    // Get current round number
    const { data: roundState } = await supabase
      .from('simulation_state')
      .select('current_round')
      .eq('id', 'global')
      .single();
    const startingRound = (roundState?.current_round || 0) + 1;

    // Load agents
    let agents = await agentService.getActiveAgents();
    if (agents.length === 0) {
      return NextResponse.json({ success: false, error: 'No active agents found' }, { status: 400 });
    }

    // Filter agents if specific IDs provided
    if (agentIds && agentIds.length > 0) {
      const idSet = new Set(agentIds);
      agents = agents.filter(a => idSet.has(a.id));
      if (agents.length === 0) {
        return NextResponse.json({ success: false, error: 'None of the specified agents are active' }, { status: 400 });
      }
    } else if (agentCount && agentCount > 0 && agentCount < agents.length) {
      // Agent count must be a multiple of 3 (equal per type)
      if (agentCount % 3 !== 0) {
        return NextResponse.json({ success: false, error: `agent_count must be a multiple of 3 (got ${agentCount})` }, { status: 400 });
      }
      // Even split: N/3 agents per type (e.g. 3 = 1 each, 6 = 2 each, 9 = 3 each)
      const perType = agentCount / 3;
      const typeOrder = ['REVIEW', 'CURATION', 'CATALOG'];
      const selectedAgents: typeof agents = [];
      for (const type of typeOrder) {
        const typeAgents = agents.filter(a => a.type === type);
        selectedAgents.push(...typeAgents.slice(0, perType));
      }
      agents = selectedAgents;
    }

    console.log(`[Simulate-v2] Loaded ${agents.length} active agents`);

    // Create the x402-paying fetch once for all rounds (same path as production)
    const payingFetch = createServerPayingFetch();

    const localTaskService = new TaskService();
    const roundResults: RoundProcessorResult[] = [];

    for (let i = 0; i < rounds; i++) {
      const roundNum = startingRound + i;

      // Generate synthetic tasks
      const taskInputs = TaskService.generateRandomTaskInputs(tasksPerRound, { priceMin, priceMax });
      const tasks = await localTaskService.createBatchTasks(taskInputs);

      // Run the unified pipeline
      const config: RoundConfig = { useBlockchain, useLLM, roundNumber: roundNum, livingCostPerRound: LIVING_COST_PER_ROUND, payingFetch };
      const result = await roundProcessor.processRound(tasks, agents, config);
      roundResults.push(result);

      // Refresh agents for next round
      agents = await agentService.refreshAgentData(agents);
    }

    // Update round counter
    await supabase.from('simulation_state').upsert({
      id: 'global',
      current_round: startingRound + rounds - 1,
      updated_at: new Date().toISOString(),
    });

    const totals = roundResults.reduce((acc, r) => ({
      tasks: acc.tasks + r.tasksProcessed,
      bids: acc.bids + r.bidsPlaced,
      completed: acc.completed + r.tasksCompleted,
      revenue: acc.revenue + r.totalRevenue,
      wakeups: acc.wakeups + r.brainWakeups.length,
    }), { tasks: 0, bids: 0, completed: 0, revenue: 0, wakeups: 0 });

    console.log(`[Simulate-v2] Completed ${rounds} rounds: ${totals.completed}/${totals.tasks} tasks, ${totals.wakeups} brain wakeups`);

    return NextResponse.json({
      success: true,
      data: {
        rounds_completed: rounds,
        starting_round: startingRound,
        ending_round: startingRound + rounds - 1,
        total_tasks: totals.tasks,
        total_bids: totals.bids,
        total_completed: totals.completed,
        total_revenue: Math.round(totals.revenue * 10000) / 10000,
        brain_wakeups: roundResults.flatMap(r => r.brainWakeups),
        rounds: roundResults.map(r => ({
          round: r.round,
          tasksCreated: r.tasksProcessed,
          bidsPlaced: r.bidsPlaced,
          tasksCompleted: r.tasksCompleted,
          totalRevenue: r.totalRevenue,
          brainWakeups: r.brainWakeups.length,
          agentStates: r.agentStates,
        })),
      },
    });
  } catch (error) {
    console.error('[Simulate-v2] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
