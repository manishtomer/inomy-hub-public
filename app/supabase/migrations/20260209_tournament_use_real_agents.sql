-- ============================================================================
-- Refactor tournaments to use real agents
--
-- Drop tournament_agents (duplicated agent data) and tournament_results.
-- Replace with tournament_entries: a join table referencing real agents.
-- Tournament-specific stats (wins, balance snapshot) live here.
-- Agent data (name, type, personality, reputation) comes from the agents table.
-- ============================================================================

-- Drop old tables
DROP TABLE IF EXISTS tournament_results CASCADE;
DROP TABLE IF EXISTS tournament_agents CASCADE;

-- New join table: which real agents are in which tournament
CREATE TABLE IF NOT EXISTS tournament_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  enrolled_by VARCHAR,                               -- wallet that enrolled this agent
  -- Tournament-scoped stats (don't mutate the real agent)
  starting_balance NUMERIC(10, 4) NOT NULL DEFAULT 0, -- snapshot at enrollment
  balance_delta NUMERIC(10, 4) NOT NULL DEFAULT 0,    -- P/L during tournament
  wins INTEGER NOT NULL DEFAULT 0,
  bids INTEGER NOT NULL DEFAULT 0,
  rank INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_entries_tournament ON tournament_entries(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_agent ON tournament_entries(agent_id);

COMMENT ON TABLE tournament_entries IS 'Join table enrolling real agents into tournaments with tournament-scoped stats';
