-- Simulation State Migration
-- Tracks global simulation state (current round number)
-- Also creates agent_policies table for storing policy versions

-- ============================================================================
-- SIMULATION STATE TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS simulation_state (
  id TEXT PRIMARY KEY DEFAULT 'global',
  current_round INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert initial state
INSERT INTO simulation_state (id, current_round)
VALUES ('global', 0)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- AGENT POLICIES TABLE
-- ============================================================================

-- Stores policy versions for each agent
-- Each brain wake-up can create a new policy version
CREATE TABLE IF NOT EXISTS agent_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  policy_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT agent_policies_policy_data_not_empty CHECK (policy_data != '{}'::jsonb)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_agent_policies_agent_id ON agent_policies(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_policies_created_at ON agent_policies(created_at DESC);

-- ============================================================================
-- EXCEPTION HISTORY TABLE
-- ============================================================================

-- Tracks all exceptions that triggered brain wake-ups
CREATE TABLE IF NOT EXISTS exception_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  exception_type TEXT NOT NULL,
  exception_details TEXT,
  current_value NUMERIC,
  threshold NUMERIC,
  brain_response JSONB DEFAULT '{}',
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exception_history_agent_id ON exception_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_exception_history_type ON exception_history(exception_type);
CREATE INDEX IF NOT EXISTS idx_exception_history_created_at ON exception_history(created_at DESC);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE simulation_state IS 'Global simulation state tracking';
COMMENT ON TABLE agent_policies IS 'Version history of agent policies, updated by brain wake-ups';
COMMENT ON TABLE exception_history IS 'Record of all exceptions that triggered brain wake-ups';
