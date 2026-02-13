-- ============================================================================
-- Industry Reports Migration
-- Created: 2026-02-08
-- Description: Table for storing LLM-generated analyst reports on the agent
--              economy, plus config columns on simulation_state for scheduling.
-- ============================================================================

-- ============================================================================
-- INDUSTRY REPORTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS industry_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_number INTEGER NOT NULL,
  start_round INTEGER NOT NULL,
  end_round INTEGER NOT NULL,

  -- Computed metrics (structured JSONB for querying)
  metrics JSONB NOT NULL DEFAULT '{}',

  -- LLM-generated narrative sections (structured JSONB)
  narrative JSONB NOT NULL DEFAULT '{}',

  -- Generation metadata
  model_used VARCHAR(100),
  generation_time_ms INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index on report_number (one report per number)
CREATE UNIQUE INDEX IF NOT EXISTS idx_industry_reports_number
  ON industry_reports(report_number);

-- Index for fetching latest reports
CREATE INDEX IF NOT EXISTS idx_industry_reports_end_round
  ON industry_reports(end_round DESC);

-- ============================================================================
-- SIMULATION STATE CONFIG COLUMNS (for report scheduling)
-- ============================================================================

ALTER TABLE simulation_state
  ADD COLUMN IF NOT EXISTS report_interval INTEGER NOT NULL DEFAULT 20;

ALTER TABLE simulation_state
  ADD COLUMN IF NOT EXISTS report_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash-lite';

ALTER TABLE simulation_state
  ADD COLUMN IF NOT EXISTS last_report_round INTEGER NOT NULL DEFAULT 0;

-- ============================================================================
-- ADD 'industry_report' EVENT TYPE TO INDUSTRY_MEMORY
-- ============================================================================

-- Drop and recreate the CHECK constraint to include the new event type
ALTER TABLE industry_memory
  DROP CONSTRAINT IF EXISTS industry_memory_event_type_check;

ALTER TABLE industry_memory
  ADD CONSTRAINT industry_memory_event_type_check CHECK (event_type IN (
    'market_crash',
    'price_compression',
    'demand_surge',
    'new_competitor_wave',
    'partnership_trend',
    'agent_death',
    'market_shift',
    'industry_report'
  ));

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE industry_reports IS 'Periodic LLM-generated analyst reports on the agent economy';
COMMENT ON COLUMN industry_reports.metrics IS 'Computed market and agent statistics for the report period';
COMMENT ON COLUMN industry_reports.narrative IS 'LLM-generated narrative with sections: headline, executive_summary, market_dynamics, agent_spotlight, strategy_analysis, outlook, awards';
COMMENT ON COLUMN industry_reports.model_used IS 'Which LLM model generated the narrative';
COMMENT ON COLUMN industry_reports.generation_time_ms IS 'Time taken to generate the report in milliseconds';
