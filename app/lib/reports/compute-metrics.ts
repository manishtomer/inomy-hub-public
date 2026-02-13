/**
 * Report Metrics Computation Engine
 *
 * Queries the database for a given round range and computes structured
 * market + per-agent statistics used to generate industry reports.
 *
 * Data sources:
 *   - tasks (filtered by round_number)
 *   - bids_cache (fetched by time range to avoid Supabase URL length limits)
 *   - agents (current state)
 *   - agent_memories (brain wakeup counts by round_number)
 *   - economy_events (agent deaths, filtered by round_number)
 *   - exception_history (exception counts, filtered by round_number)
 *
 * Created: 2026-02-08
 * Updated: 2026-02-08 - Fixed bid query (time-range instead of .in() with 800+ IDs)
 */

import { supabase } from '@/lib/supabase';
import type { ReportMetrics, ReportAgentMetrics, ReportMarketMetrics, ReportEventMetrics, ReportStrategyEvolution, StrategyMoment, AgentStrategyEvolution, ReportCompetitiveDynamics, RoundWinner, AgentBidEntry, AgentBidTrajectory, MarginChangeEvent, RoundBidSpread, TaskTypeCompetitiveDynamics } from '@/types/database';

/**
 * Compute all metrics for a report covering [startRound, endRound].
 */
export async function computeReportMetrics(
  startRound: number,
  endRound: number
): Promise<ReportMetrics> {
  // Step 1: Fetch tasks by round_number
  const { data: roundTasks } = await supabase
    .from('tasks')
    .select('id, type, status, round_number, assigned_agent_id, max_bid, created_at')
    .gte('round_number', startRound)
    .lte('round_number', endRound)
    .limit(5000);

  let tasks: typeof roundTasks = roundTasks || [];

  if (tasks.length === 0) {
    console.warn(`[ReportMetrics] No tasks with round_number in ${startRound}-${endRound}. Run the backfill migration (20260208_round_number_consistency.sql) to populate round_number on existing data.`);
  }

  console.log(`[ReportMetrics] Using ${tasks.length} tasks for report (rounds ${startRound}-${endRound})`);

  // Step 2: Fetch bids, agents, runtime state, events, exceptions in parallel
  // All queries use round_number for consistent filtering.
  const [bidsResult, agentsResult, eventsResult, exceptionsResult] = await Promise.all([
    // Bids by round_number (added via migration 20260208_round_number_consistency)
    supabase
      .from('bids_cache')
      .select('id, task_id, agent_id, amount, status, policy_used, round_number, created_at')
      .gte('round_number', startRound)
      .lte('round_number', endRound)
      .limit(10000),

    // Current agent states
    supabase
      .from('agents')
      .select('id, name, type, personality, balance, reputation, status'),

    // Economy events by round_number
    supabase
      .from('economy_events')
      .select('event_type, agent_wallets, metadata, round_number')
      .in('event_type', ['brain_decision', 'policy_change', 'agent_death'])
      .gte('round_number', startRound)
      .lte('round_number', endRound),

    // Exception history by round_number
    supabase
      .from('exception_history')
      .select('id, agent_id, exception_type, round_number')
      .gte('round_number', startRound)
      .lte('round_number', endRound),
  ]);

  const bids = bidsResult.data || [];
  const agents = agentsResult.data || [];
  const events = eventsResult.data || [];
  const exceptions = exceptionsResult.data || [];

  console.log(`[ReportMetrics] Found ${bids.length} bids, ${agents.length} agents, ${events.length} events, ${exceptions.length} exceptions (rounds ${startRound}-${endRound})`);

  // ── Per-agent brain wakeup counts ──
  // Count DISTINCT (agent_id, round_number) from agent_memories.
  // Multiple exception memories fire per round (consecutive_losses, low_balance, etc.)
  // but they represent a single brain wakeup for that round.
  const { data: wakeupMemories } = await supabase
    .from('agent_memories')
    .select('agent_id, round_number')
    .in('memory_type', ['exception_handled', 'qbr_insight'])
    .gte('round_number', startRound)
    .lte('round_number', endRound)
    .limit(5000);

  // Count distinct rounds per agent (1 wakeup per round regardless of exception count)
  const wakeupRoundsByAgent = new Map<string, Set<number>>();
  for (const mem of (wakeupMemories || [])) {
    if (!wakeupRoundsByAgent.has(mem.agent_id)) wakeupRoundsByAgent.set(mem.agent_id, new Set());
    wakeupRoundsByAgent.get(mem.agent_id)!.add(mem.round_number);
  }
  const wakeupsByAgentId = new Map<string, number>();
  for (const [agentId, rounds] of wakeupRoundsByAgent) {
    wakeupsByAgentId.set(agentId, rounds.size);
  }

  const agentIdToName = new Map(agents.map(a => [a.id, a.name]));

  // ── Per-agent policy change counts ──
  // Each brain wakeup creates one brain_decision economy_event.
  // If the brain changed policy, metadata.policy_changes is non-empty.
  // brain_decision events have round_number (backfilled via migration step 5).
  // 1 event with non-empty policy_changes = 1 policy change.
  const { data: brainEventsRound } = await supabase
    .from('economy_events')
    .select('metadata')
    .eq('event_type', 'brain_decision')
    .gte('round_number', startRound)
    .lte('round_number', endRound);

  const policyChangesByAgentName = countPolicyChanges(brainEventsRound || []);

  // Build name-keyed wakeup map
  const perAgentWakeups = new Map<string, number>();
  for (const [agentId, count] of wakeupsByAgentId) {
    const name = agentIdToName.get(agentId);
    if (name) perAgentWakeups.set(name, count);
  }
  const perAgentPolicyChanges = policyChangesByAgentName;

  const totalWakeups = [...wakeupsByAgentId.values()].reduce((s, v) => s + v, 0);
  const totalPolicyChanges = [...perAgentPolicyChanges.values()].reduce((s, v) => s + v, 0);
  console.log(`[ReportMetrics] Brain wakeups: ${totalWakeups}, Policy changes: ${totalPolicyChanges}`);

  // ── Market Metrics ──────────────────────────────────────────────
  const market = computeMarketMetrics(tasks, bids, startRound, endRound);

  // ── Per-Agent Metrics ───────────────────────────────────────────
  const agentMetrics = computeAgentMetrics(bids, agents, perAgentWakeups, perAgentPolicyChanges);

  // ── Event Metrics ───────────────────────────────────────────────
  const eventMetrics = computeEventMetrics(events, exceptions, totalWakeups, totalPolicyChanges);

  // ── Strategy Evolution ────────────────────────────────────────────
  const agentLookup = new Map(agents.map(a => [a.id, a]));
  const strategy = await queryStrategyEvolution(startRound, endRound, agentLookup, perAgentWakeups, perAgentPolicyChanges);

  // ── Competitive Dynamics ────────────────────────────────────────
  const competitive = computeCompetitiveDynamics(tasks, bids, agents, events);
  console.log(`[ReportMetrics] Competitive dynamics: ${competitive.by_task_type.length} task types, ${competitive.margin_changes.length} margin changes`);

  return {
    market,
    agents: agentMetrics,
    events: eventMetrics,
    strategy,
    competitive,
  };
}

/**
 * Compute market-level statistics
 */
function computeMarketMetrics(
  tasks: Array<{ id: string; type: string; status: string; round_number: number | null; max_bid: number; created_at: string }>,
  bids: Array<{ id: string; task_id: string; agent_id: string; amount: number; status: string; policy_used: unknown; created_at: string }>,
  _startRound: number,
  _endRound: number
): ReportMarketMetrics {
  const totalTasks = tasks.length;
  const totalBids = bids.length;

  // Winning bids
  const winningBids = bids.filter(b => b.status === 'WON' || b.status === 'won');
  const totalRevenue = winningBids.reduce((sum, b) => sum + Number(b.amount), 0);
  const avgWinningBid = winningBids.length > 0
    ? totalRevenue / winningBids.length
    : 0;

  // All bids average
  const avgBidAll = totalBids > 0
    ? bids.reduce((sum, b) => sum + Number(b.amount), 0) / totalBids
    : 0;

  // Average bidders per task
  const bidsPerTask = new Map<string, Set<string>>();
  for (const bid of bids) {
    if (!bidsPerTask.has(bid.task_id)) bidsPerTask.set(bid.task_id, new Set());
    bidsPerTask.get(bid.task_id)!.add(bid.agent_id);
  }
  const avgBiddersPerTask = bidsPerTask.size > 0
    ? [...bidsPerTask.values()].reduce((sum, s) => sum + s.size, 0) / bidsPerTask.size
    : 0;

  // Margin stats from policy_used
  const margins: number[] = [];
  for (const bid of bids) {
    const margin = extractMargin(bid.policy_used);
    if (margin !== null) margins.push(margin);
  }
  const marginAvg = margins.length > 0 ? margins.reduce((s, v) => s + v, 0) / margins.length : 0;
  const marginMin = margins.length > 0 ? Math.min(...margins) : 0;
  const marginMax = margins.length > 0 ? Math.max(...margins) : 0;

  // Winning bid trend: first half vs second half by created_at timestamp
  const sortedWins = [...winningBids].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const midIdx = Math.floor(sortedWins.length / 2);
  const firstHalfWins = sortedWins.slice(0, midIdx);
  const secondHalfWins = sortedWins.slice(midIdx);

  const avgFirst = firstHalfWins.length > 0
    ? firstHalfWins.reduce((s, b) => s + Number(b.amount), 0) / firstHalfWins.length
    : 0;
  const avgSecond = secondHalfWins.length > 0
    ? secondHalfWins.reduce((s, b) => s + Number(b.amount), 0) / secondHalfWins.length
    : 0;

  let winningBidTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
  if (avgFirst > 0 && avgSecond > 0) {
    const delta = avgSecond - avgFirst;
    if (delta > 0.001) winningBidTrend = 'increasing';
    else if (delta < -0.001) winningBidTrend = 'decreasing';
  }

  return {
    total_tasks: totalTasks,
    total_bids: totalBids,
    total_revenue: round4(totalRevenue),
    avg_winning_bid: round4(avgWinningBid),
    avg_bid_all: round4(avgBidAll),
    avg_bidders_per_task: round2(avgBiddersPerTask),
    winning_bid_trend: winningBidTrend,
    margin_avg: round4(marginAvg),
    margin_min: round4(marginMin),
    margin_max: round4(marginMax),
  };
}

/**
 * Compute per-agent statistics.
 * Uses bids for period-specific data. Brain wakeups and policy changes
 * are pre-counted from time-filtered economy_events.
 */
function computeAgentMetrics(
  bids: Array<{ id: string; task_id: string; agent_id: string; amount: number; status: string; policy_used: unknown }>,
  agents: Array<{ id: string; name: string; type: string; personality: string; balance: number; reputation: number; status: string }>,
  perAgentWakeups: Map<string, number>,
  perAgentPolicyChanges: Map<string, number>,
): ReportAgentMetrics[] {
  // Group bids by agent
  const agentBids = new Map<string, typeof bids>();
  for (const bid of bids) {
    if (!agentBids.has(bid.agent_id)) agentBids.set(bid.agent_id, []);
    agentBids.get(bid.agent_id)!.push(bid);
  }

  const results: ReportAgentMetrics[] = [];

  for (const agent of agents) {
    if (agent.status === 'DEAD') continue; // skip dead agents

    const myBids = agentBids.get(agent.id) || [];

    // Period-specific only — no fallback to all-time runtime state
    const wins = myBids.filter(b => b.status === 'WON' || b.status === 'won').length;
    const losses = myBids.filter(b => b.status === 'LOST' || b.status === 'lost').length;
    const totalBids = myBids.length;
    const winRate = totalBids > 0 ? wins / totalBids : 0;

    const avgBid = myBids.length > 0
      ? myBids.reduce((s, b) => s + Number(b.amount), 0) / myBids.length
      : 0;

    // Margin stats
    const margins: number[] = [];
    for (const bid of myBids) {
      const m = extractMargin(bid.policy_used);
      if (m !== null) margins.push(m);
    }
    const avgMargin = margins.length > 0
      ? margins.reduce((s, v) => s + v, 0) / margins.length
      : null;

    results.push({
      id: agent.id,
      name: agent.name,
      type: agent.type,
      personality: agent.personality || 'unknown',
      bids: totalBids,
      wins,
      losses,
      win_rate: round4(winRate),
      avg_bid: round4(avgBid),
      avg_margin: avgMargin !== null ? round4(avgMargin) : null,
      balance_start: round4(agent.balance),
      balance_end: round4(agent.balance),
      balance_delta: 0,
      reputation_delta: 0,
      brain_wakeups: perAgentWakeups.get(agent.name) || 0,
      policy_changes: perAgentPolicyChanges.get(agent.name) || 0,
    });
  }

  // Sort by wins descending, then by balance
  results.sort((a, b) => b.wins - a.wins || b.balance_end - a.balance_end);

  return results;
}

/**
 * Compute event-level statistics.
 * Brain wakeups and policy changes come from round-filtered agent_memories
 * (passed in as pre-computed totals). Agent deaths come from economy_events.
 */
function computeEventMetrics(
  events: Array<{ event_type: string }>,
  exceptions: Array<{ id: string }>,
  roundFilteredWakeups: number,
  roundFilteredPolicyChanges: number,
): ReportEventMetrics {
  let agentDeaths = 0;
  for (const event of events) {
    if (event.event_type === 'agent_death') agentDeaths++;
  }

  return {
    brain_decisions: roundFilteredWakeups,
    policy_changes: roundFilteredPolicyChanges,
    exceptions: exceptions.length,
    agent_deaths: agentDeaths,
  };
}

/**
 * Query agent_memories, exception_history, qbr_history to build per-agent
 * strategy evolution data showing how agents adapted during the period.
 */
async function queryStrategyEvolution(
  startRound: number,
  endRound: number,
  agentLookup: Map<string, { id: string; name: string; type: string; personality: string }>,
  perAgentWakeups: Map<string, number>,
  perAgentPolicyChanges: Map<string, number>,
): Promise<ReportStrategyEvolution> {
  const [memoriesResult, exceptionsResult, qbrResult] = await Promise.all([
    supabase
      .from('agent_memories')
      .select('agent_id, memory_type, round_number, trigger_context, narrative, importance_score')
      .in('memory_type', ['exception_handled', 'qbr_insight', 'learning'])
      .gte('importance_score', 0.6)
      .gte('round_number', startRound)
      .lte('round_number', endRound)
      .order('importance_score', { ascending: false })
      .limit(50),

    supabase
      .from('exception_history')
      .select('agent_id, exception_type, exception_details, brain_response, created_at')
      .limit(30),

    supabase
      .from('qbr_history')
      .select('agent_id, qbr_number, period, decisions, created_at')
      .limit(20),
  ]);

  const memories = memoriesResult.data || [];
  const exceptions = exceptionsResult.data || [];
  const qbrs = qbrResult.data || [];

  // Group moments by agent_id
  const agentMoments = new Map<string, StrategyMoment[]>();

  const addMoment = (agentId: string, moment: StrategyMoment) => {
    if (!agentMoments.has(agentId)) agentMoments.set(agentId, []);
    agentMoments.get(agentId)!.push(moment);
  };

  // Memories → moments
  for (const mem of memories) {
    const momentType: StrategyMoment['type'] =
      mem.memory_type === 'exception_handled' ? 'exception' :
      mem.memory_type === 'qbr_insight' ? 'qbr' : 'learning';

    addMoment(mem.agent_id, {
      round: mem.round_number,
      type: momentType,
      trigger: mem.trigger_context || undefined,
      narrative: mem.narrative ? mem.narrative.slice(0, 300) : undefined,
    });
  }

  // Exceptions → moments (with brain reasoning + policy changes)
  for (const exc of exceptions) {
    const brain = exc.brain_response as Record<string, unknown> | null;
    const reasoning = brain?.reasoning as string | undefined;
    const policyChanges = brain?.policy_changes as Record<string, unknown> | undefined;

    addMoment(exc.agent_id, {
      round: 0, // exception_history doesn't have round_number
      type: 'exception',
      trigger: exc.exception_type,
      reasoning: reasoning ? reasoning.slice(0, 300) : exc.exception_details?.slice(0, 300),
      policy_changes: policyChanges,
    });
  }

  // QBRs → moments
  for (const qbr of qbrs) {
    const decisions = qbr.decisions as Record<string, unknown> | null;
    const reasoning = decisions?.reasoning as string | undefined;
    const policyChanges = decisions?.policy_changes as Record<string, unknown> | undefined;
    const period = qbr.period as Record<string, unknown> | null;
    const round = (period?.end_round as number) || 0;

    addMoment(qbr.agent_id, {
      round,
      type: 'qbr',
      trigger: `QBR #${qbr.qbr_number}`,
      reasoning: reasoning ? reasoning.slice(0, 300) : undefined,
      policy_changes: policyChanges,
    });
  }

  // Build per-agent evolution, sorted by most moments first
  const agentEvolutions: AgentStrategyEvolution[] = [];

  for (const [agentId, moments] of agentMoments) {
    const agent = agentLookup.get(agentId);
    if (!agent) continue;

    // Sort moments by round descending, take top 4
    moments.sort((a, b) => b.round - a.round);
    const topMoments = moments.slice(0, 4);

    agentEvolutions.push({
      agent_id: agentId,
      agent_name: agent.name,
      agent_type: agent.type,
      personality: agent.personality || 'unknown',
      brain_wakeups: perAgentWakeups.get(agent.name) || 0,
      policy_changes: perAgentPolicyChanges.get(agent.name) || 0,
      moments: topMoments,
    });
  }

  // Sort by number of moments (most interesting first), take top 5
  agentEvolutions.sort((a, b) => b.moments.length - a.moments.length);
  const topAgents = agentEvolutions.slice(0, 5);

  console.log(`[ReportMetrics] Strategy evolution: ${topAgents.length} agents with ${topAgents.reduce((s, a) => s + a.moments.length, 0)} moments`);

  return { agents: topAgents };
}

/**
 * Compute competitive dynamics: winner timelines, bid trajectories,
 * bid spread convergence, and margin change annotations.
 */
function computeCompetitiveDynamics(
  tasks: Array<{ id: string; type: string; round_number: number | null; max_bid: number; created_at: string }>,
  bids: Array<{ id: string; task_id: string; agent_id: string; amount: number; status: string; policy_used: unknown; round_number?: number | null; created_at: string }>,
  agents: Array<{ id: string; name: string; type: string; personality: string; balance: number; reputation: number; status: string }>,
  brainEvents: Array<{ event_type: string; agent_wallets: string[]; metadata: unknown; round_number: number | null }>,
): ReportCompetitiveDynamics {
  // Build lookup maps
  const taskTypeMap = new Map<string, string>();
  const taskRoundMap = new Map<string, number>();
  for (const t of tasks) {
    taskTypeMap.set(t.id, t.type);
    if (t.round_number) taskRoundMap.set(t.id, t.round_number);
  }

  const agentNameMap = new Map<string, string>();
  const nameToIdMap = new Map<string, string>();
  for (const a of agents) {
    agentNameMap.set(a.id, a.name);
    nameToIdMap.set(a.name, a.id);
  }

  // Task types present in the data
  const taskTypes = [...new Set(tasks.map(t => t.type))].sort();

  // Enrich bids with round and type info
  const enrichedBids = bids.map(b => ({
    ...b,
    taskType: taskTypeMap.get(b.task_id) || 'UNKNOWN',
    round: (b as { round_number?: number | null }).round_number || taskRoundMap.get(b.task_id) || 0,
    agentName: agentNameMap.get(b.agent_id) || 'Unknown',
    won: b.status === 'WON' || b.status === 'won',
  })).filter(b => b.round > 0);

  // ── Per task type dynamics ──
  const byTaskType: TaskTypeCompetitiveDynamics[] = [];

  for (const taskType of taskTypes) {
    const typeBids = enrichedBids.filter(b => b.taskType === taskType);
    if (typeBids.length === 0) continue;

    const rounds = [...new Set(typeBids.map(b => b.round))].sort((a, b) => a - b);

    // Winner timeline
    const winners: RoundWinner[] = [];
    let prevWinnerId = '';
    let leadershipChanges = 0;
    const uniqueWinnerSet = new Set<string>();

    for (const round of rounds) {
      const roundBids = typeBids.filter(b => b.round === round);
      const wonBid = roundBids.find(b => b.won);
      if (wonBid) {
        uniqueWinnerSet.add(wonBid.agent_id);
        if (prevWinnerId && prevWinnerId !== wonBid.agent_id) leadershipChanges++;
        prevWinnerId = wonBid.agent_id;

        winners.push({
          round,
          winner_name: wonBid.agentName,
          winner_bid: round4(wonBid.amount),
          winner_id: wonBid.agent_id,
          num_bidders: roundBids.length,
        });
      }
    }

    // Bid trajectories per agent
    const agentIds = [...new Set(typeBids.map(b => b.agent_id))];
    const trajectories: AgentBidTrajectory[] = [];

    for (const agentId of agentIds) {
      const agentBids = typeBids.filter(b => b.agent_id === agentId);
      const entries: AgentBidEntry[] = agentBids
        .map(b => ({ round: b.round, amount: round4(b.amount), won: b.won }))
        .sort((a, b) => a.round - b.round);

      const wins = entries.filter(e => e.won).length;
      const avg = entries.reduce((s, e) => s + e.amount, 0) / entries.length;

      trajectories.push({
        agent_id: agentId,
        agent_name: agentNameMap.get(agentId) || 'Unknown',
        type: taskType,
        entries,
        wins,
        total: entries.length,
        avg_bid: round4(avg),
      });
    }
    trajectories.sort((a, b) => b.wins - a.wins);

    // Bid spreads per round
    const bidSpreads: RoundBidSpread[] = [];
    for (const round of rounds) {
      const roundBids = typeBids.filter(b => b.round === round);
      if (roundBids.length < 2) continue;
      const amounts = roundBids.map(b => b.amount);
      const low = Math.min(...amounts);
      const high = Math.max(...amounts);
      bidSpreads.push({
        round,
        low_bid: round4(low),
        high_bid: round4(high),
        spread: round4(high - low),
        num_bidders: roundBids.length,
      });
    }

    byTaskType.push({
      task_type: taskType,
      winners,
      unique_winners: uniqueWinnerSet.size,
      leadership_changes: leadershipChanges,
      bid_trajectories: trajectories,
      bid_spreads: bidSpreads,
    });
  }

  // ── Margin change events from brain decisions ──
  const marginChanges: MarginChangeEvent[] = [];

  // Per-agent average bid by round (across all task types)
  const agentRoundBids = new Map<string, Map<number, number>>();
  for (const b of enrichedBids) {
    if (!agentRoundBids.has(b.agent_id)) agentRoundBids.set(b.agent_id, new Map());
    const rm = agentRoundBids.get(b.agent_id)!;
    if (!rm.has(b.round)) rm.set(b.round, b.amount);
    else rm.set(b.round, (rm.get(b.round)! + b.amount) / 2);
  }

  for (const event of brainEvents) {
    if (event.event_type !== 'brain_decision') continue;
    const meta = event.metadata as Record<string, unknown> | null;
    if (!meta) continue;

    const round = event.round_number || 0;
    if (round === 0) continue;

    // Look for margin in policy_changes or changes_applied
    const policyChanges = (meta.policy_changes || meta.changes_applied) as Record<string, unknown> | undefined;
    if (!policyChanges || typeof policyChanges !== 'object') continue;

    // Extract margin change — handles {old, new} and {from, to} formats
    let oldMargin: number | null = null;
    let newMargin: number | null = null;

    const mc = policyChanges.bidding_margin || policyChanges.target_margin;
    if (mc && typeof mc === 'object') {
      const mcObj = mc as Record<string, unknown>;
      if ('old' in mcObj && 'new' in mcObj) {
        oldMargin = Number(mcObj.old);
        newMargin = Number(mcObj.new);
      } else if ('from' in mcObj && 'to' in mcObj) {
        oldMargin = Number(mcObj.from);
        newMargin = Number(mcObj.to);
      }
    }

    if (oldMargin === null || newMargin === null || oldMargin === newMargin) continue;
    if (isNaN(oldMargin) || isNaN(newMargin)) continue;

    const agentName = (meta.agent_name as string) || 'Unknown';
    const agentId = nameToIdMap.get(agentName) || '';
    const trigger = (meta.trigger as string) || (meta.trigger_type as string) || 'brain_decision';

    // Find bid amounts before/after the change round
    let oldBid = 0;
    let newBid = 0;
    const roundBids = agentRoundBids.get(agentId);
    if (roundBids) {
      const sortedRounds = [...roundBids.keys()].sort((a, b) => a - b);
      for (const r of sortedRounds) {
        if (r <= round) oldBid = roundBids.get(r)!;
      }
      for (const r of sortedRounds) {
        if (r > round) { newBid = roundBids.get(r)!; break; }
      }
      if (newBid === 0 && oldBid > 0) newBid = oldBid;
    }

    const direction = newMargin < oldMargin ? 'cut' : 'raised';
    const bidDirection = newBid < oldBid ? 'dropped' : 'rose';
    const annotation = oldBid > 0
      ? `Brain ${direction} margin ${oldMargin}% -> ${newMargin}%: bid ${bidDirection} $${oldBid.toFixed(4)} -> $${newBid.toFixed(4)}`
      : `Brain ${direction} margin ${oldMargin}% -> ${newMargin}%`;

    marginChanges.push({
      round,
      agent_id: agentId,
      agent_name: agentName,
      trigger,
      old_margin: oldMargin,
      new_margin: newMargin,
      old_bid: round4(oldBid),
      new_bid: round4(newBid),
      annotation,
    });
  }

  marginChanges.sort((a, b) => a.round - b.round);

  return { by_task_type: byTaskType, margin_changes: marginChanges };
}

/**
 * Extract margin from policy_used JSONB
 * Handles both string and object forms
 */
function extractMargin(policyUsed: unknown): number | null {
  if (!policyUsed) return null;

  try {
    const policy = typeof policyUsed === 'string'
      ? JSON.parse(policyUsed)
      : policyUsed;

    // actual_margin is the preferred field
    if (typeof policy.actual_margin === 'number') return policy.actual_margin;
    if (typeof policy.margin === 'number') return policy.margin;

    return null;
  } catch {
    return null;
  }
}

/**
 * Count policy changes per agent from round-filtered brain_decision events.
 * Used when brain_decision events have round_number (future data).
 * Returns Map keyed by agent name.
 */
function countPolicyChanges(events: Array<{ metadata: unknown }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    const meta = event.metadata as Record<string, unknown> | null;
    if (!meta) continue;
    const pc = meta.policy_changes as Record<string, unknown> | undefined;
    if (pc && typeof pc === 'object' && Object.keys(pc).length > 0) {
      const name = (meta.agent_name as string) || 'unknown';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return counts;
}


function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
