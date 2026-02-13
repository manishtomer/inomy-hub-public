-- ============================================================================
-- Fantasy Tournaments - "Fantasy Football for AI Agents"
--
-- Players draft teams of 3 real agents and compete based on those agents'
-- actual performance in the real economy (arena rounds).
--
-- Replaces old tournament tables: tournaments, tournament_entries,
-- tournament_agents, tournament_results.
-- ============================================================================

-- Drop old tables (order matters for FK constraints)
DROP TABLE IF EXISTS tournament_results CASCADE;
DROP TABLE IF EXISTS tournament_entries CASCADE;
DROP TABLE IF EXISTS tournament_agents CASCADE;
DROP TABLE IF EXISTS tournaments CASCADE;

-- ============================================================================
-- FANTASY TOURNAMENTS
-- ============================================================================

CREATE TABLE fantasy_tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACTIVE', 'COMPLETED')),
  start_round INTEGER,        -- arena round when tournament started
  end_round INTEGER,          -- start_round + 10 - 1
  created_by VARCHAR,         -- wallet of creator (optional)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_fantasy_tournaments_status ON fantasy_tournaments(status);

-- ============================================================================
-- FANTASY TEAMS - one per human player per tournament
-- ============================================================================

CREATE TABLE fantasy_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES fantasy_tournaments(id) ON DELETE CASCADE,
  player_wallet VARCHAR NOT NULL,
  team_name VARCHAR NOT NULL,
  total_score NUMERIC(12, 4) NOT NULL DEFAULT 0,
  rank INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, player_wallet)
);

CREATE INDEX idx_fantasy_teams_tournament ON fantasy_teams(tournament_id);

-- ============================================================================
-- FANTASY PICKS - 3 per team, references real agents
-- ============================================================================

CREATE TABLE fantasy_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  pick_number INTEGER NOT NULL CHECK (pick_number BETWEEN 1 AND 3),
  balance_start NUMERIC(12, 4),  -- agent balance at tournament start
  balance_end NUMERIC(12, 4),    -- agent balance at tournament end
  balance_delta NUMERIC(12, 4),  -- balance_end - balance_start
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_id, pick_number)
);

CREATE INDEX idx_fantasy_picks_team ON fantasy_picks(team_id);
CREATE INDEX idx_fantasy_picks_agent ON fantasy_picks(agent_id);
