-- ============================================================================
-- Game Arena Migration
-- Created: 2026-02-10
-- Description: Seasons, leaderboard, round snapshots, and arena state columns.
--              Turns the simulation into an interactive arena game.
-- ============================================================================

-- ============================================================================
-- SEASONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_number INTEGER NOT NULL UNIQUE,
  start_round INTEGER NOT NULL,
  end_round INTEGER,
  status VARCHAR NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED')),
  champion_agent_id UUID REFERENCES agents(id),
  summary JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_seasons_number ON seasons(season_number DESC);
CREATE INDEX IF NOT EXISTS idx_seasons_status ON seasons(status);

-- ============================================================================
-- SEASON LEADERBOARD TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS season_leaderboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  score NUMERIC(10, 4) NOT NULL DEFAULT 0,
  balance_delta NUMERIC(10, 4) NOT NULL DEFAULT 0,
  win_rate NUMERIC(5, 4) NOT NULL DEFAULT 0,
  reputation_delta NUMERIC(10, 4) NOT NULL DEFAULT 0,
  tasks_won INTEGER NOT NULL DEFAULT 0,
  tasks_bid INTEGER NOT NULL DEFAULT 0,
  UNIQUE(season_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_season_leaderboard_season ON season_leaderboard(season_id);
CREATE INDEX IF NOT EXISTS idx_season_leaderboard_rank ON season_leaderboard(season_id, rank);

-- ============================================================================
-- ROUND SNAPSHOTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS round_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number INTEGER NOT NULL,
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  balance NUMERIC(10, 4) NOT NULL,
  reputation NUMERIC(10, 2) NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(round_number, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_round_snapshots_round ON round_snapshots(round_number);
CREATE INDEX IF NOT EXISTS idx_round_snapshots_season ON round_snapshots(season_id);
CREATE INDEX IF NOT EXISTS idx_round_snapshots_agent ON round_snapshots(agent_id);

-- ============================================================================
-- ARENA STATE COLUMNS ON simulation_state
-- ============================================================================

ALTER TABLE simulation_state
  ADD COLUMN IF NOT EXISTS arena_status VARCHAR NOT NULL DEFAULT 'IDLE'
    CHECK (arena_status IN ('IDLE', 'RUNNING', 'PAUSED'));

ALTER TABLE simulation_state
  ADD COLUMN IF NOT EXISTS arena_speed INTEGER NOT NULL DEFAULT 1;

ALTER TABLE simulation_state
  ADD COLUMN IF NOT EXISTS arena_auto_run BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE simulation_state
  ADD COLUMN IF NOT EXISTS arena_auto_interval_ms INTEGER NOT NULL DEFAULT 5000;

ALTER TABLE simulation_state
  ADD COLUMN IF NOT EXISTS current_season_id UUID REFERENCES seasons(id);

ALTER TABLE simulation_state
  ADD COLUMN IF NOT EXISTS rounds_per_season INTEGER NOT NULL DEFAULT 50;

ALTER TABLE simulation_state
  ADD COLUMN IF NOT EXISTS arena_lock_holder TEXT;

ALTER TABLE simulation_state
  ADD COLUMN IF NOT EXISTS arena_lock_expires_at TIMESTAMPTZ;

-- ============================================================================
-- ADD NEW EVENT TYPES FOR ARENA
-- ============================================================================

ALTER TABLE economy_events
  DROP CONSTRAINT IF EXISTS economy_events_type_check;

ALTER TABLE economy_events
  ADD CONSTRAINT economy_events_type_check CHECK (
    event_type IN (
      -- Original types
      'task_completed', 'investment', 'partnership', 'agent_death',
      'auction_won', 'policy_change', 'dividend_paid', 'token_bought',
      'token_sold', 'reputation_changed',
      -- x402 payment flow types
      'task_assigned', 'task_payment', 'cost_sink_payment', 'x402_payment',
      -- Living cost
      'living_cost',
      -- Bid and brain events
      'bid_placed', 'brain_decision',
      -- Arena game events
      'season_start', 'season_end', 'round_complete'
    )
  );

-- ============================================================================
-- PREDICTION TABLES (Phase 2)
-- ============================================================================

CREATE TABLE IF NOT EXISTS prediction_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number INTEGER NOT NULL UNIQUE,
  questions JSONB NOT NULL DEFAULT '[]',
  status VARCHAR NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'LOCKED', 'SCORED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scored_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prediction_rounds_round ON prediction_rounds(round_number DESC);
CREATE INDEX IF NOT EXISTS idx_prediction_rounds_status ON prediction_rounds(status);

CREATE TABLE IF NOT EXISTS predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_round_id UUID NOT NULL REFERENCES prediction_rounds(id) ON DELETE CASCADE,
  user_wallet VARCHAR NOT NULL,
  answers JSONB NOT NULL DEFAULT '[]',
  score INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(prediction_round_id, user_wallet)
);

CREATE INDEX IF NOT EXISTS idx_predictions_round ON predictions(prediction_round_id);
CREATE INDEX IF NOT EXISTS idx_predictions_user ON predictions(user_wallet);

CREATE TABLE IF NOT EXISTS prediction_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet VARCHAR NOT NULL UNIQUE,
  total_predictions INTEGER NOT NULL DEFAULT 0,
  correct_predictions INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  total_score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prediction_profiles_score ON prediction_profiles(total_score DESC);

-- ============================================================================
-- TOURNAMENT TABLES (Phase 3)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  status VARCHAR NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'COMPLETED')),
  max_agents INTEGER NOT NULL DEFAULT 12,
  current_round INTEGER NOT NULL DEFAULT 0,
  total_rounds INTEGER NOT NULL DEFAULT 20,
  creator_wallet VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);

CREATE TABLE IF NOT EXISTS tournament_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  creator_wallet VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  type VARCHAR NOT NULL CHECK (type IN ('CATALOG', 'REVIEW', 'CURATION', 'SELLER')),
  personality VARCHAR NOT NULL DEFAULT 'balanced',
  balance NUMERIC(10, 4) NOT NULL DEFAULT 0.5,
  reputation NUMERIC(10, 2) NOT NULL DEFAULT 500,
  policy JSONB DEFAULT '{}',
  rank INTEGER,
  total_wins INTEGER NOT NULL DEFAULT 0,
  total_bids INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, creator_wallet)
);

CREATE INDEX IF NOT EXISTS idx_tournament_agents_tournament ON tournament_agents(tournament_id);

CREATE TABLE IF NOT EXISTS tournament_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES tournament_agents(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  final_balance NUMERIC(10, 4) NOT NULL,
  total_wins INTEGER NOT NULL DEFAULT 0,
  total_revenue NUMERIC(10, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_results_tournament ON tournament_results(tournament_id, rank);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE seasons IS 'Arena seasons - groups of rounds with a champion';
COMMENT ON TABLE season_leaderboard IS 'Per-season agent rankings and performance';
COMMENT ON TABLE round_snapshots IS 'Per-round agent state snapshots for charts/replay';
COMMENT ON TABLE prediction_rounds IS 'Per-round prediction questions for users';
COMMENT ON TABLE predictions IS 'User prediction answers and scores';
COMMENT ON TABLE prediction_profiles IS 'Aggregate user prediction stats';
COMMENT ON TABLE tournaments IS 'Sandboxed tournament configurations';
COMMENT ON TABLE tournament_agents IS 'Agents created for specific tournaments (not in main agents table)';
COMMENT ON TABLE tournament_results IS 'Final tournament rankings';
