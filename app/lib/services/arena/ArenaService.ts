/**
 * ArenaService - Manages the simulation arena game loop
 *
 * Handles arena locking, season lifecycle, round snapshots,
 * and leaderboard computation.
 */

import { supabase } from '@/lib/supabase';
import { createEvent } from '@/lib/api-helpers';
// Types from '../types' used indirectly via service consumers

// ============================================================================
// TYPES
// ============================================================================

export interface ArenaState {
  currentRound: number;
  arenaStatus: 'IDLE' | 'RUNNING' | 'PAUSED';
  arenaSpeed: number;
  autoRun: boolean;
  autoIntervalMs: number;
  roundsPerSeason: number;
  isLocked: boolean;
  lockHolder: string | null;
  lockExpiresAt: string | null;
  season: SeasonInfo | null;
}

export interface SeasonInfo {
  id: string;
  seasonNumber: number;
  startRound: number;
  endRound: number | null;
  status: 'ACTIVE' | 'COMPLETED';
  championAgentId: string | null;
  roundsCompleted: number;
  roundsTotal: number;
}

export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  agentType: string;
  score: number;
  balanceDelta: number;
  winRate: number;
  reputationDelta: number;
  tasksWon: number;
  tasksBid: number;
}

export interface SeasonSummary {
  id: string;
  seasonNumber: number;
  startRound: number;
  endRound: number | null;
  status: string;
  championAgentId: string | null;
  championName: string | null;
  completedAt: string | null;
}

export interface RoundSnapshot {
  roundNumber: number;
  agentId: string;
  balance: number;
  reputation: number;
  status: string;
}

const LOCK_TTL_MS = 30_000; // 30 seconds

export class ArenaService {
  /**
   * Acquire exclusive lock for running rounds.
   * Returns true if lock acquired, false if already held.
   */
  async acquireLock(holder: string = 'anonymous'): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS).toISOString();

    // Read current lock state
    const { data: state } = await supabase
      .from('simulation_state')
      .select('arena_lock_holder, arena_lock_expires_at')
      .eq('id', 'global')
      .single();

    if (state?.arena_lock_holder) {
      // Lock is held — check if expired
      const lockExpiry = state.arena_lock_expires_at ? new Date(state.arena_lock_expires_at) : null;
      if (lockExpiry && lockExpiry > now) {
        return false; // Lock is active and not expired
      }
      // Lock is expired — fall through to acquire
    }

    // Acquire the lock
    const { data, error } = await supabase
      .from('simulation_state')
      .update({
        arena_lock_holder: holder,
        arena_lock_expires_at: expiresAt,
        arena_status: 'RUNNING',
        updated_at: now.toISOString(),
      })
      .eq('id', 'global')
      .select()
      .single();

    if (error || !data) {
      return false;
    }
    return true;
  }

  /**
   * Release the arena lock.
   */
  async releaseLock(): Promise<void> {
    await supabase
      .from('simulation_state')
      .update({
        arena_lock_holder: null,
        arena_lock_expires_at: null,
        arena_status: 'IDLE',
        updated_at: new Date().toISOString(),
      })
      .eq('id', 'global');
  }

  /**
   * Ensure an active season exists. Creates one if none active.
   * Returns the active season.
   */
  async ensureActiveSeason(currentRound: number): Promise<SeasonInfo> {
    // Check for existing active season
    const { data: existing } = await supabase
      .from('seasons')
      .select('*')
      .eq('status', 'ACTIVE')
      .order('season_number', { ascending: false })
      .limit(1)
      .single();

    if (existing) {
      // Get rounds_per_season from state
      const { data: state } = await supabase
        .from('simulation_state')
        .select('rounds_per_season')
        .eq('id', 'global')
        .single();
      const roundsPerSeason = state?.rounds_per_season || 50;

      return {
        id: existing.id,
        seasonNumber: existing.season_number,
        startRound: existing.start_round,
        endRound: existing.end_round,
        status: existing.status,
        championAgentId: existing.champion_agent_id,
        roundsCompleted: currentRound - existing.start_round,
        roundsTotal: roundsPerSeason,
      };
    }

    // Get last season number
    const { data: lastSeason } = await supabase
      .from('seasons')
      .select('season_number')
      .order('season_number', { ascending: false })
      .limit(1)
      .single();

    const nextNumber = (lastSeason?.season_number || 0) + 1;

    // Get rounds_per_season from state
    const { data: state } = await supabase
      .from('simulation_state')
      .select('rounds_per_season')
      .eq('id', 'global')
      .single();
    const roundsPerSeason = state?.rounds_per_season || 50;

    // Create new season
    const { data: newSeason, error } = await supabase
      .from('seasons')
      .insert({
        season_number: nextNumber,
        start_round: currentRound + 1,
        status: 'ACTIVE',
      })
      .select()
      .single();

    if (error || !newSeason) {
      throw new Error(`Failed to create season: ${error?.message}`);
    }

    // Update simulation_state with current season
    await supabase
      .from('simulation_state')
      .update({ current_season_id: newSeason.id })
      .eq('id', 'global');

    // Emit season_start event
    await createEvent({
      event_type: 'season_start',
      description: `Season ${nextNumber} has begun!`,
      amount: null,
      round_number: currentRound + 1,
      metadata: { season_number: nextNumber, season_id: newSeason.id },
    });

    return {
      id: newSeason.id,
      seasonNumber: nextNumber,
      startRound: currentRound + 1,
      endRound: null,
      status: 'ACTIVE',
      championAgentId: null,
      roundsCompleted: 0,
      roundsTotal: roundsPerSeason,
    };
  }

  /**
   * Finalize a season: compute leaderboard, set champion, create events.
   */
  async finalizeSeason(seasonId: string, endRound: number): Promise<LeaderboardEntry[]> {
    const leaderboard = await this.computeLeaderboard(seasonId);

    const champion = leaderboard[0];

    // Update season
    await supabase
      .from('seasons')
      .update({
        status: 'COMPLETED',
        end_round: endRound,
        champion_agent_id: champion?.agentId || null,
        completed_at: new Date().toISOString(),
        summary: {
          totalRounds: endRound,
          champion: champion ? { id: champion.agentId, name: champion.agentName, score: champion.score } : null,
          topThree: leaderboard.slice(0, 3).map(e => ({ id: e.agentId, name: e.agentName, score: e.score })),
        },
      })
      .eq('id', seasonId);

    // Clear current_season_id
    await supabase
      .from('simulation_state')
      .update({ current_season_id: null })
      .eq('id', 'global');

    // Get season number for event
    const { data: season } = await supabase
      .from('seasons')
      .select('season_number')
      .eq('id', seasonId)
      .single();

    await createEvent({
      event_type: 'season_end',
      description: champion
        ? `Season ${season?.season_number} ended! Champion: ${champion.agentName} (Score: ${champion.score.toFixed(2)})`
        : `Season ${season?.season_number} ended!`,
      amount: champion?.balanceDelta || null,
      round_number: endRound,
      metadata: {
        season_id: seasonId,
        season_number: season?.season_number,
        champion: champion ? { id: champion.agentId, name: champion.agentName } : null,
        leaderboard: leaderboard.slice(0, 5),
      },
    });

    return leaderboard;
  }

  /**
   * Save a round snapshot for all agents.
   */
  async saveRoundSnapshot(
    roundNumber: number,
    seasonId: string,
    agents: Array<{ id: string; balance: number; reputation: number; status?: string }>
  ): Promise<void> {
    const rows = agents.map(a => ({
      round_number: roundNumber,
      season_id: seasonId,
      agent_id: a.id,
      balance: a.balance,
      reputation: a.reputation,
      status: a.status || 'ACTIVE',
    }));

    const { error } = await supabase
      .from('round_snapshots')
      .upsert(rows, { onConflict: 'round_number,agent_id' });

    if (error) {
      console.error('[ArenaService] Failed to save round snapshots:', error);
    }
  }

  /**
   * Compute leaderboard for a season based on round snapshots and agent stats.
   * Score = balance_delta×0.4 + win_rate×0.3 + reputation_delta×0.3
   */
  async computeLeaderboard(seasonId: string): Promise<LeaderboardEntry[]> {
    // Get season info
    const { data: season } = await supabase
      .from('seasons')
      .select('start_round, end_round')
      .eq('id', seasonId)
      .single();

    if (!season) return [];

    // Get first and last snapshots for each agent in this season
    const { data: snapshots } = await supabase
      .from('round_snapshots')
      .select('agent_id, round_number, balance, reputation')
      .eq('season_id', seasonId)
      .order('round_number', { ascending: true });

    if (!snapshots || snapshots.length === 0) return [];

    // Group by agent
    const agentSnapshots = new Map<string, typeof snapshots>();
    for (const s of snapshots) {
      const arr = agentSnapshots.get(s.agent_id) || [];
      arr.push(s);
      agentSnapshots.set(s.agent_id, arr);
    }

    // Get agent details and bid stats
    const agentIds = Array.from(agentSnapshots.keys());
    const { data: agents } = await supabase
      .from('agents')
      .select('id, name, type')
      .in('id', agentIds);

    const agentMap = new Map((agents || []).map(a => [a.id, a]));

    // Compute stats per agent
    const entries: LeaderboardEntry[] = [];

    for (const [agentId, snaps] of agentSnapshots) {
      const first = snaps[0];
      const last = snaps[snaps.length - 1];
      const agent = agentMap.get(agentId);
      if (!agent) continue;

      const balanceDelta = last.balance - first.balance;
      const reputationDelta = last.reputation - first.reputation;

      // Count wins from bids in the runtime state
      const { data: runtimeState } = await supabase
        .from('agent_runtime_state')
        .select('total_wins, total_bids')
        .eq('agent_id', agentId)
        .single();

      const totalWins = runtimeState?.total_wins || 0;
      const totalBids = runtimeState?.total_bids || 1;
      const winRate = totalBids > 0 ? totalWins / totalBids : 0;

      // Normalize for scoring (use absolute values scaled to 0-1 range)
      const score = (balanceDelta * 0.4) + (winRate * 100 * 0.3) + (reputationDelta * 0.001 * 0.3);

      entries.push({
        rank: 0,
        agentId,
        agentName: agent.name,
        agentType: agent.type,
        score: Math.round(score * 10000) / 10000,
        balanceDelta: Math.round(balanceDelta * 10000) / 10000,
        winRate: Math.round(winRate * 10000) / 10000,
        reputationDelta: Math.round(reputationDelta * 100) / 100,
        tasksWon: totalWins,
        tasksBid: totalBids,
      });
    }

    // Sort by score descending and assign ranks
    entries.sort((a, b) => b.score - a.score);
    entries.forEach((e, i) => { e.rank = i + 1; });

    // Save to season_leaderboard
    const rows = entries.map(e => ({
      season_id: seasonId,
      agent_id: e.agentId,
      rank: e.rank,
      score: e.score,
      balance_delta: e.balanceDelta,
      win_rate: e.winRate,
      reputation_delta: e.reputationDelta,
      tasks_won: e.tasksWon,
      tasks_bid: e.tasksBid,
    }));

    if (rows.length > 0) {
      await supabase
        .from('season_leaderboard')
        .upsert(rows, { onConflict: 'season_id,agent_id' });
    }

    return entries;
  }

  /**
   * Get current arena state including season info.
   */
  async getArenaState(): Promise<ArenaState> {
    const { data: state } = await supabase
      .from('simulation_state')
      .select('*')
      .eq('id', 'global')
      .single();

    if (!state) {
      return {
        currentRound: 0,
        arenaStatus: 'IDLE',
        arenaSpeed: 1,
        autoRun: false,
        autoIntervalMs: 5000,
        roundsPerSeason: 50,
        isLocked: false,
        lockHolder: null,
        lockExpiresAt: null,
        season: null,
      };
    }

    // Check if lock is expired
    const now = new Date();
    const lockExpired = state.arena_lock_expires_at && new Date(state.arena_lock_expires_at) < now;
    const isLocked = !!(state.arena_lock_holder && !lockExpired);

    // Get active season
    let season: SeasonInfo | null = null;
    if (state.current_season_id) {
      const { data: seasonData } = await supabase
        .from('seasons')
        .select('*')
        .eq('id', state.current_season_id)
        .single();

      if (seasonData) {
        season = {
          id: seasonData.id,
          seasonNumber: seasonData.season_number,
          startRound: seasonData.start_round,
          endRound: seasonData.end_round,
          status: seasonData.status,
          championAgentId: seasonData.champion_agent_id,
          roundsCompleted: state.current_round - seasonData.start_round,
          roundsTotal: state.rounds_per_season || 50,
        };
      }
    }

    return {
      currentRound: state.current_round || 0,
      arenaStatus: lockExpired ? 'IDLE' : (state.arena_status || 'IDLE'),
      arenaSpeed: state.arena_speed || 1,
      autoRun: state.arena_auto_run || false,
      autoIntervalMs: state.arena_auto_interval_ms || 5000,
      roundsPerSeason: state.rounds_per_season || 50,
      isLocked,
      lockHolder: isLocked ? state.arena_lock_holder : null,
      lockExpiresAt: isLocked ? state.arena_lock_expires_at : null,
      season,
    };
  }

  /**
   * Update auto-run settings.
   */
  async updateAutoRun(autoRun: boolean, intervalMs?: number, speed?: number): Promise<void> {
    const updates: Record<string, unknown> = {
      arena_auto_run: autoRun,
      updated_at: new Date().toISOString(),
    };
    if (intervalMs !== undefined) updates.arena_auto_interval_ms = intervalMs;
    if (speed !== undefined) updates.arena_speed = speed;
    if (!autoRun) updates.arena_status = 'IDLE';

    await supabase
      .from('simulation_state')
      .update(updates)
      .eq('id', 'global');
  }

  /**
   * Get all seasons with optional champion names.
   */
  async getSeasons(): Promise<SeasonSummary[]> {
    const { data: seasons } = await supabase
      .from('seasons')
      .select('*')
      .order('season_number', { ascending: false });

    if (!seasons) return [];

    // Get champion names
    const championIds = seasons.filter(s => s.champion_agent_id).map(s => s.champion_agent_id);
    const { data: champions } = championIds.length > 0
      ? await supabase.from('agents').select('id, name').in('id', championIds)
      : { data: [] };

    const champMap = new Map((champions || []).map(c => [c.id, c.name]));

    return seasons.map(s => ({
      id: s.id,
      seasonNumber: s.season_number,
      startRound: s.start_round,
      endRound: s.end_round,
      status: s.status,
      championAgentId: s.champion_agent_id,
      championName: champMap.get(s.champion_agent_id) || null,
      completedAt: s.completed_at,
    }));
  }

  /**
   * Get round snapshots for charting.
   */
  async getSnapshots(options?: {
    seasonId?: string;
    agentId?: string;
    fromRound?: number;
    toRound?: number;
    limit?: number;
  }): Promise<RoundSnapshot[]> {
    let query = supabase
      .from('round_snapshots')
      .select('round_number, agent_id, balance, reputation, status')
      .order('round_number', { ascending: true });

    if (options?.seasonId) query = query.eq('season_id', options.seasonId);
    if (options?.agentId) query = query.eq('agent_id', options.agentId);
    if (options?.fromRound) query = query.gte('round_number', options.fromRound);
    if (options?.toRound) query = query.lte('round_number', options.toRound);
    if (options?.limit) query = query.limit(options.limit);

    const { data } = await query;

    return (data || []).map(s => ({
      roundNumber: s.round_number,
      agentId: s.agent_id,
      balance: s.balance,
      reputation: s.reputation,
      status: s.status,
    }));
  }

  /**
   * Check if the current round is at a season boundary.
   */
  isSeasonBoundary(currentRound: number, season: SeasonInfo): boolean {
    const roundsInSeason = currentRound - season.startRound + 1;
    return roundsInSeason >= season.roundsTotal;
  }
}

// Singleton
export const arenaService = new ArenaService();
