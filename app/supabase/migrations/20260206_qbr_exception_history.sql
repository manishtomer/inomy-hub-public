-- ============================================================================
-- QBR & EXCEPTION HISTORY TABLES
-- Migration: 20260206_qbr_exception_history.sql
-- Purpose: Store historical records of QBRs and exception handling
-- ============================================================================

-- ============================================================================
-- QBR HISTORY TABLE
-- Records each Quarterly Business Review for audit and analysis
-- ============================================================================

CREATE TABLE IF NOT EXISTS qbr_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  qbr_number INTEGER NOT NULL DEFAULT 1,

  -- Period information
  period JSONB NOT NULL DEFAULT '{}',
  -- Structure: { rounds_since_last: number, start_round: number, end_round: number }

  -- Input metrics at time of QBR
  input_metrics JSONB NOT NULL DEFAULT '{}',
  -- Structure: { win_rate_start, win_rate_end, balance_start, balance_end, reputation_start, reputation_end }

  -- Decisions made during QBR
  decisions JSONB NOT NULL DEFAULT '{}',
  -- Structure: { policy_changes: {}, partnership_actions: [], reasoning: string, investor_update: {} }

  -- Outcome tracking (filled in after next QBR)
  outcome JSONB,
  -- Structure: { actual_win_rate, actual_balance_change, success: boolean }

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for qbr_history
CREATE INDEX IF NOT EXISTS idx_qbr_history_agent_id ON qbr_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_qbr_history_created_at ON qbr_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qbr_history_qbr_number ON qbr_history(agent_id, qbr_number);

-- ============================================================================
-- EXCEPTION HISTORY TABLE
-- Records each exception and how it was handled
-- ============================================================================

CREATE TABLE IF NOT EXISTS exception_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,

  -- Exception details
  exception_type VARCHAR(30) NOT NULL CHECK (exception_type IN (
    'consecutive_losses',
    'low_balance',
    'reputation_drop',
    'win_rate_drop',
    'unknown_situation'
  )),
  exception_details TEXT NOT NULL DEFAULT '',
  current_value NUMERIC(20,8) NOT NULL DEFAULT 0,
  threshold NUMERIC(20,8) NOT NULL DEFAULT 0,

  -- Brain response
  brain_response JSONB NOT NULL DEFAULT '{}',
  -- Structure: { policy_changes: {}, observations: [], changes: [], survival_impact, growth_impact }

  -- Resolution tracking
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  time_to_resolution_rounds INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for exception_history
CREATE INDEX IF NOT EXISTS idx_exception_history_agent_id ON exception_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_exception_history_created_at ON exception_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exception_history_type ON exception_history(exception_type);
CREATE INDEX IF NOT EXISTS idx_exception_history_resolved ON exception_history(resolved);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE qbr_history IS 'Historical record of Quarterly Business Reviews for each agent';
COMMENT ON TABLE exception_history IS 'Historical record of exceptions and their resolutions';

COMMENT ON COLUMN qbr_history.qbr_number IS 'Sequential number of this QBR for the agent (1st, 2nd, etc.)';
COMMENT ON COLUMN qbr_history.period IS 'Time period covered by this QBR (rounds)';
COMMENT ON COLUMN qbr_history.input_metrics IS 'Performance metrics at time of QBR';
COMMENT ON COLUMN qbr_history.decisions IS 'Decisions made including policy changes and partnership actions';
COMMENT ON COLUMN qbr_history.outcome IS 'Actual outcomes after implementing decisions (filled in later)';

COMMENT ON COLUMN exception_history.exception_type IS 'Type of exception that triggered brain wake-up';
COMMENT ON COLUMN exception_history.brain_response IS 'Brain analysis and recommended actions';
COMMENT ON COLUMN exception_history.resolved IS 'Whether the exception condition has been addressed';
COMMENT ON COLUMN exception_history.time_to_resolution_rounds IS 'How many rounds it took to resolve';
