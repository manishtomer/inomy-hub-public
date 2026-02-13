/**
 * FantasyTournamentService - "Fantasy Football for AI Agents"
 *
 * Players draft teams of 3 real agents and compete based on those agents'
 * actual performance in the real economy (arena rounds).
 *
 * Scoring: team_score = sum(pick.balance_end - pick.balance_start)
 * Balance values come from round_snapshots table.
 */

import { supabase } from '@/lib/supabase';

const ROUNDS_PER_TOURNAMENT = 10;
const PICKS_PER_TEAM = 3;

// ============================================================================
// TYPES
// ============================================================================

export interface FantasyTournament {
  id: string;
  name: string;
  status: 'OPEN' | 'ACTIVE' | 'COMPLETED';
  startRound: number | null;
  endRound: number | null;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  teamCount?: number;
  entryFee: number;
  prizePool: number;
}

export interface FantasyTeam {
  id: string;
  tournamentId: string;
  playerWallet: string;
  teamName: string;
  totalScore: number;
  rank: number | null;
  payoutAmount: number;
  picks: FantasyPick[];
}

export interface FantasyPick {
  id: string;
  teamId: string;
  agentId: string;
  pickNumber: number;
  balanceStart: number | null;
  balanceEnd: number | null;
  balanceDelta: number | null;
  // Joined from agents
  agentName?: string;
  agentType?: string;
}

export interface FantasyTournamentDetail {
  tournament: FantasyTournament;
  teams: FantasyTeam[];
}

// ============================================================================
// SERVICE
// ============================================================================

export class FantasyTournamentService {
  /**
   * Create a new OPEN tournament.
   */
  async createTournament(name: string, createdBy?: string, entryFee: number = 0): Promise<FantasyTournament> {
    const { data, error } = await supabase
      .from('fantasy_tournaments')
      .insert({
        name,
        status: 'OPEN',
        created_by: createdBy || null,
        entry_fee: entryFee,
        prize_pool: 0,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create tournament: ${error?.message}`);
    }

    return this.mapTournament(data);
  }

  /**
   * Validate a join attempt without inserting anything.
   * Throws on validation failure.
   */
  async validateJoin(
    tournamentId: string,
    playerWallet: string,
    agentIds: string[]
  ): Promise<void> {
    if (agentIds.length !== PICKS_PER_TEAM) {
      throw new Error(`Must pick exactly ${PICKS_PER_TEAM} agents`);
    }
    if (new Set(agentIds).size !== agentIds.length) {
      throw new Error('Cannot pick the same agent twice');
    }

    const { data: tournament } = await supabase
      .from('fantasy_tournaments')
      .select('status')
      .eq('id', tournamentId)
      .single();

    if (!tournament || tournament.status !== 'OPEN') {
      throw new Error('Tournament is not accepting teams');
    }

    const { data: agents } = await supabase
      .from('agents')
      .select('id')
      .in('id', agentIds);

    if (!agents || agents.length !== agentIds.length) {
      throw new Error('One or more agents not found');
    }

    // Check not already joined
    const { data: existing } = await supabase
      .from('fantasy_teams')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('player_wallet', playerWallet)
      .limit(1);

    if (existing && existing.length > 0) {
      throw new Error('You have already joined this tournament');
    }
  }

  /**
   * Join a tournament by drafting a team of 3 agents.
   */
  async joinTournament(
    tournamentId: string,
    playerWallet: string,
    teamName: string,
    agentIds: string[]
  ): Promise<FantasyTeam> {
    if (agentIds.length !== PICKS_PER_TEAM) {
      throw new Error(`Must pick exactly ${PICKS_PER_TEAM} agents`);
    }

    // Check unique agents
    if (new Set(agentIds).size !== agentIds.length) {
      throw new Error('Cannot pick the same agent twice');
    }

    // Check tournament is OPEN
    const { data: tournament } = await supabase
      .from('fantasy_tournaments')
      .select('status, entry_fee, prize_pool')
      .eq('id', tournamentId)
      .single();

    if (!tournament || tournament.status !== 'OPEN') {
      throw new Error('Tournament is not accepting teams');
    }

    const entryFee = Number(tournament.entry_fee) || 0;

    // Verify all agents exist
    const { data: agents } = await supabase
      .from('agents')
      .select('id')
      .in('id', agentIds);

    if (!agents || agents.length !== agentIds.length) {
      throw new Error('One or more agents not found');
    }

    // Create team
    const { data: team, error: teamError } = await supabase
      .from('fantasy_teams')
      .insert({
        tournament_id: tournamentId,
        player_wallet: playerWallet,
        team_name: teamName,
      })
      .select()
      .single();

    if (teamError || !team) {
      if (teamError?.code === '23505') {
        throw new Error('You already have a team in this tournament');
      }
      throw new Error(`Failed to create team: ${teamError?.message}`);
    }

    // Create picks
    const pickRows = agentIds.map((agentId, i) => ({
      team_id: team.id,
      agent_id: agentId,
      pick_number: i + 1,
    }));

    const { error: pickError } = await supabase
      .from('fantasy_picks')
      .insert(pickRows);

    if (pickError) {
      // Rollback team
      await supabase.from('fantasy_teams').delete().eq('id', team.id);
      throw new Error(`Failed to save picks: ${pickError.message}`);
    }

    // Increment prize pool by entry fee
    if (entryFee > 0) {
      const newPool = Number(tournament.prize_pool || 0) + entryFee;
      await supabase
        .from('fantasy_tournaments')
        .update({ prize_pool: newPool })
        .eq('id', tournamentId);
    }

    return {
      id: team.id,
      tournamentId,
      playerWallet,
      teamName,
      totalScore: 0,
      rank: null,
      payoutAmount: 0,
      picks: pickRows.map((p) => ({
        id: '',
        teamId: team.id,
        agentId: p.agent_id,
        pickNumber: p.pick_number,
        balanceStart: null,
        balanceEnd: null,
        balanceDelta: null,
        agentName: undefined,
        agentType: undefined,
      })),
    };
  }

  /**
   * Start a tournament: set ACTIVE, capture start_round, snapshot agent balances.
   */
  async startTournament(tournamentId: string): Promise<void> {
    // Check tournament is OPEN
    const { data: tournament } = await supabase
      .from('fantasy_tournaments')
      .select('status')
      .eq('id', tournamentId)
      .single();

    if (!tournament || tournament.status !== 'OPEN') {
      throw new Error('Tournament is not in OPEN state');
    }

    // Check at least 2 teams
    const { count } = await supabase
      .from('fantasy_teams')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId);

    if ((count || 0) < 2) {
      throw new Error('Need at least 2 teams to start');
    }

    // Get current arena round
    const { data: simState } = await supabase
      .from('simulation_state')
      .select('current_round')
      .eq('id', 'global')
      .single();

    const currentRound = simState?.current_round || 0;
    const startRound = currentRound + 1;
    const endRound = startRound + ROUNDS_PER_TOURNAMENT - 1;

    // Update tournament
    const { error: updateError } = await supabase
      .from('fantasy_tournaments')
      .update({
        status: 'ACTIVE',
        start_round: startRound,
        end_round: endRound,
        started_at: new Date().toISOString(),
      })
      .eq('id', tournamentId);

    if (updateError) {
      throw new Error(`Failed to start tournament: ${updateError.message}`);
    }

    // Snapshot starting balances from agents table (current USDC balance)
    const { data: picks } = await supabase
      .from('fantasy_picks')
      .select('id, agent_id, fantasy_teams!inner(tournament_id)')
      .eq('fantasy_teams.tournament_id', tournamentId);

    if (picks) {
      // Get agent balances
      const agentIds = [...new Set(picks.map(p => p.agent_id))];
      const { data: agents } = await supabase
        .from('agents')
        .select('id, usdc_balance')
        .in('id', agentIds);

      const balanceMap = new Map((agents || []).map(a => [a.id, a.usdc_balance || 0]));

      // Update each pick with starting balance
      for (const pick of picks) {
        await supabase
          .from('fantasy_picks')
          .update({ balance_start: balanceMap.get(pick.agent_id) || 0 })
          .eq('id', pick.id);
      }
    }
  }

  /**
   * Called after each arena round completes.
   * Checks if any ACTIVE tournament has reached its end_round.
   */
  async onRoundComplete(roundNumber: number): Promise<void> {
    const { data: tournaments } = await supabase
      .from('fantasy_tournaments')
      .select('id, end_round')
      .eq('status', 'ACTIVE')
      .lte('end_round', roundNumber);

    if (!tournaments || tournaments.length === 0) return;

    for (const t of tournaments) {
      try {
        await this.scoreTournament(t.id);
      } catch (err) {
        console.error(`[FantasyTournament] Failed to score tournament ${t.id}:`, err);
      }
    }
  }

  /**
   * Score and complete a tournament.
   * Reads agent balances from round_snapshots at end_round.
   */
  async scoreTournament(tournamentId: string): Promise<void> {
    const { data: tournament } = await supabase
      .from('fantasy_tournaments')
      .select('*')
      .eq('id', tournamentId)
      .single();

    if (!tournament || tournament.status !== 'ACTIVE') return;

    const endRound = tournament.end_round;

    // Get all picks for this tournament
    const { data: teams } = await supabase
      .from('fantasy_teams')
      .select('id, fantasy_picks(id, agent_id, balance_start)')
      .eq('tournament_id', tournamentId);

    if (!teams) return;

    // Get all unique agent IDs
    const allAgentIds = new Set<string>();
    for (const team of teams) {
      const picks = (team as Record<string, unknown>).fantasy_picks as Array<Record<string, unknown>>;
      if (picks) {
        for (const p of picks) {
          allAgentIds.add(p.agent_id as string);
        }
      }
    }

    // Get end-round balances from round_snapshots
    const { data: snapshots } = await supabase
      .from('round_snapshots')
      .select('agent_id, balance')
      .eq('round_number', endRound)
      .in('agent_id', Array.from(allAgentIds));

    // Fallback: if snapshots don't exist yet (round hasn't been snapshotted),
    // use current agent balances
    let endBalanceMap: Map<string, number>;

    if (snapshots && snapshots.length > 0) {
      endBalanceMap = new Map(snapshots.map(s => [s.agent_id, Number(s.balance)]));
    } else {
      const { data: agents } = await supabase
        .from('agents')
        .select('id, usdc_balance')
        .in('id', Array.from(allAgentIds));
      endBalanceMap = new Map((agents || []).map(a => [a.id, Number(a.usdc_balance || 0)]));
    }

    // Score each team
    for (const team of teams) {
      const picks = (team as Record<string, unknown>).fantasy_picks as Array<Record<string, unknown>>;
      if (!picks) continue;

      let teamScore = 0;

      for (const pick of picks) {
        const balanceStart = Number(pick.balance_start || 0);
        const balanceEnd = endBalanceMap.get(pick.agent_id as string) || balanceStart;
        const delta = balanceEnd - balanceStart;

        await supabase
          .from('fantasy_picks')
          .update({
            balance_end: balanceEnd,
            balance_delta: delta,
          })
          .eq('id', pick.id as string);

        teamScore += delta;
      }

      await supabase
        .from('fantasy_teams')
        .update({ total_score: teamScore })
        .eq('id', (team as Record<string, unknown>).id as string);
    }

    // Assign ranks (highest score = rank 1)
    const { data: rankedTeams } = await supabase
      .from('fantasy_teams')
      .select('id, total_score, player_wallet')
      .eq('tournament_id', tournamentId)
      .order('total_score', { ascending: false });

    if (rankedTeams) {
      for (let i = 0; i < rankedTeams.length; i++) {
        await supabase
          .from('fantasy_teams')
          .update({ rank: i + 1 })
          .eq('id', rankedTeams[i].id);
      }
    }

    // Distribute prize pool to top teams
    const prizePool = Number(tournament.prize_pool) || 0;
    if (prizePool > 0 && rankedTeams && rankedTeams.length > 0) {
      // Payout split: 1st=60%, 2nd=30%, 3rd=10%
      // If only 2 teams: 1st=70%, 2nd=30%
      // If only 1 team: 1st=100%
      const splits = rankedTeams.length === 1
        ? [1.0]
        : rankedTeams.length === 2
        ? [0.7, 0.3]
        : [0.6, 0.3, 0.1];

      for (let i = 0; i < splits.length && i < rankedTeams.length; i++) {
        const payout = Math.round(prizePool * splits[i] * 10000) / 10000;
        await supabase
          .from('fantasy_teams')
          .update({ payout_amount: payout })
          .eq('id', rankedTeams[i].id);
      }

      // Send actual USDC payouts from escrow
      for (let i = 0; i < splits.length && i < rankedTeams.length; i++) {
        const payout = Math.round(prizePool * splits[i] * 10000) / 10000;
        const wallet = rankedTeams[i].player_wallet;
        if (payout > 0 && wallet) {
          try {
            const { payDividendFromEscrow } = await import('@/lib/privy-server');
            const result = await payDividendFromEscrow(wallet, payout, `tournament:${tournamentId}`);
            if (result.success) {
              console.log(`[FantasyTournament] Paid $${payout} USDC to rank ${i + 1} (${wallet.slice(0, 10)}...) TX: ${result.txHash}`);
            } else {
              console.error(`[FantasyTournament] Payout failed for rank ${i + 1}: ${result.error}`);
            }
          } catch (err) {
            console.error(`[FantasyTournament] Payout error for rank ${i + 1}:`, err);
          }
        }
      }

      console.log(`[FantasyTournament] Distributed $${prizePool.toFixed(4)} prize pool across ${Math.min(splits.length, rankedTeams.length)} winners`);
    }

    // Mark tournament completed
    await supabase
      .from('fantasy_tournaments')
      .update({
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
      })
      .eq('id', tournamentId);

    console.log(`[FantasyTournament] Scored and completed tournament ${tournamentId}`);
  }

  /**
   * Get full tournament detail with teams, picks, and agent names.
   */
  async getTournament(tournamentId: string): Promise<FantasyTournamentDetail | null> {
    const { data: tournament } = await supabase
      .from('fantasy_tournaments')
      .select('*')
      .eq('id', tournamentId)
      .single();

    if (!tournament) return null;

    // Get teams with picks
    const { data: teamsData } = await supabase
      .from('fantasy_teams')
      .select('*, fantasy_picks(*, agents(name, type))')
      .eq('tournament_id', tournamentId)
      .order('total_score', { ascending: false });

    const teams: FantasyTeam[] = (teamsData || []).map((t: Record<string, unknown>) => {
      const picks = (t.fantasy_picks as Array<Record<string, unknown>> || []).map((p: Record<string, unknown>) => {
        const agent = p.agents as Record<string, unknown> | null;
        return {
          id: p.id as string,
          teamId: t.id as string,
          agentId: p.agent_id as string,
          pickNumber: p.pick_number as number,
          balanceStart: p.balance_start as number | null,
          balanceEnd: p.balance_end as number | null,
          balanceDelta: p.balance_delta as number | null,
          agentName: (agent?.name as string) || 'Unknown',
          agentType: (agent?.type as string) || 'CATALOG',
        };
      });

      // Sort picks by pick_number
      picks.sort((a, b) => a.pickNumber - b.pickNumber);

      return {
        id: t.id as string,
        tournamentId: t.tournament_id as string,
        playerWallet: t.player_wallet as string,
        teamName: t.team_name as string,
        totalScore: Number(t.total_score) || 0,
        rank: t.rank as number | null,
        payoutAmount: Number(t.payout_amount) || 0,
        picks,
      };
    });

    const mapped = this.mapTournament(tournament);
    mapped.teamCount = teams.length;

    return { tournament: mapped, teams };
  }

  /**
   * List tournaments, optionally filtered by status.
   */
  async listTournaments(status?: string): Promise<FantasyTournament[]> {
    let query = supabase
      .from('fantasy_tournaments')
      .select('*')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data } = await query;
    if (!data) return [];

    const tournaments = data.map(t => this.mapTournament(t));

    // Add team counts
    for (const t of tournaments) {
      const { count } = await supabase
        .from('fantasy_teams')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', t.id);
      t.teamCount = count || 0;
    }

    return tournaments;
  }

  /**
   * Get current arena round number.
   */
  async getCurrentRound(): Promise<number> {
    const { data } = await supabase
      .from('simulation_state')
      .select('current_round')
      .eq('id', 'global')
      .single();
    return data?.current_round || 0;
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private mapTournament(data: Record<string, unknown>): FantasyTournament {
    return {
      id: data.id as string,
      name: data.name as string,
      status: data.status as FantasyTournament['status'],
      startRound: data.start_round as number | null,
      endRound: data.end_round as number | null,
      createdBy: data.created_by as string | null,
      createdAt: data.created_at as string,
      startedAt: data.started_at as string | null,
      completedAt: data.completed_at as string | null,
      entryFee: Number(data.entry_fee) || 0,
      prizePool: Number(data.prize_pool) || 0,
    };
  }
}

// Singleton
export const fantasyTournamentService = new FantasyTournamentService();
