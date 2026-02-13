-- ============================================================================
-- Agent Runtime Implementation: Policy, State, and Investor Updates
-- Created: 2026-02-05
-- Description: Tables for agent autonomous runtime system including policies,
--              runtime state tracking, and investor transparency updates.
-- ============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- AGENT POLICY TABLE
-- Stores each agent's current policy (JSON) and metadata
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
  personality VARCHAR(30) NOT NULL CHECK (personality IN (
    'risk-taker',
    'conservative',
    'profit-maximizer',
    'volume-chaser',
    'opportunist',
    'partnership-oriented'
  )),
  policy_json JSONB NOT NULL DEFAULT '{}',
  policy_version INTEGER NOT NULL DEFAULT 1,
  last_qbr_round INTEGER NOT NULL DEFAULT 0,
  last_qbr_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for policy queries
CREATE INDEX IF NOT EXISTS idx_agent_policies_agent_id ON agent_policies(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_policies_personality ON agent_policies(personality);

-- ============================================================================
-- AGENT RUNTIME STATE TABLE
-- Stores agent runtime statistics and operational state
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_runtime_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
  current_round INTEGER NOT NULL DEFAULT 0,
  consecutive_losses INTEGER NOT NULL DEFAULT 0,
  consecutive_wins INTEGER NOT NULL DEFAULT 0,
  total_bids INTEGER NOT NULL DEFAULT 0,
  total_wins INTEGER NOT NULL DEFAULT 0,
  total_revenue NUMERIC(20,8) NOT NULL DEFAULT 0,
  total_costs NUMERIC(20,8) NOT NULL DEFAULT 0,
  total_brain_wakeups INTEGER NOT NULL DEFAULT 0,
  total_brain_cost NUMERIC(20,8) NOT NULL DEFAULT 0,
  win_rate_last_20 NUMERIC(5,4) NOT NULL DEFAULT 0,
  reputation_at_last_check NUMERIC(10,2) NOT NULL DEFAULT 500,
  win_rate_at_last_check NUMERIC(5,4) NOT NULL DEFAULT 0,
  is_running BOOLEAN NOT NULL DEFAULT false,
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for runtime state queries
CREATE INDEX IF NOT EXISTS idx_agent_runtime_state_agent_id ON agent_runtime_state(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runtime_state_is_running ON agent_runtime_state(is_running);

-- ============================================================================
-- INVESTOR UPDATES TABLE
-- Stores investor transparency updates from brain wake-ups
-- ============================================================================

CREATE TABLE IF NOT EXISTS investor_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  trigger_type VARCHAR(20) NOT NULL CHECK (trigger_type IN (
    'qbr',
    'exception',
    'novel',
    'initial'
  )),
  trigger_details TEXT NOT NULL DEFAULT '',
  observations JSONB NOT NULL DEFAULT '[]',
  changes JSONB NOT NULL DEFAULT '[]',
  survival_impact TEXT NOT NULL DEFAULT '',
  growth_impact TEXT NOT NULL DEFAULT '',
  balance_before NUMERIC(20,8) NOT NULL DEFAULT 0,
  balance_after NUMERIC(20,8) NOT NULL DEFAULT 0,
  runway_rounds INTEGER NOT NULL DEFAULT 0,
  brain_cost NUMERIC(20,8) NOT NULL DEFAULT 0,
  round_number INTEGER NOT NULL DEFAULT 0,
  policy_version_before INTEGER NOT NULL DEFAULT 0,
  policy_version_after INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for investor updates queries
CREATE INDEX IF NOT EXISTS idx_investor_updates_agent_id ON investor_updates(agent_id);
CREATE INDEX IF NOT EXISTS idx_investor_updates_created_at ON investor_updates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_investor_updates_trigger_type ON investor_updates(trigger_type);

-- ============================================================================
-- AUTO-UPDATE TRIGGERS
-- Automatically update updated_at timestamps
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for agent_policies table
DROP TRIGGER IF EXISTS update_agent_policies_updated_at ON agent_policies;
CREATE TRIGGER update_agent_policies_updated_at
  BEFORE UPDATE ON agent_policies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for agent_runtime_state table
DROP TRIGGER IF EXISTS update_agent_runtime_state_updated_at ON agent_runtime_state;
CREATE TRIGGER update_agent_runtime_state_updated_at
  BEFORE UPDATE ON agent_runtime_state
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE agent_policies IS 'Agent autonomous decision-making policies and metadata';
COMMENT ON TABLE agent_runtime_state IS 'Agent runtime statistics and operational state tracking';
COMMENT ON TABLE investor_updates IS 'Investor transparency updates generated by agent brain wake-ups';

COMMENT ON COLUMN agent_policies.personality IS 'Agent personality type determining default policy parameters';
COMMENT ON COLUMN agent_policies.policy_json IS 'Full AgentPolicy object as JSONB (bidding, partnerships, exceptions, QBR)';
COMMENT ON COLUMN agent_policies.policy_version IS 'Increments with each policy update (for tracking changes)';
COMMENT ON COLUMN agent_policies.last_qbr_round IS 'Round number when last Quarterly Business Review occurred';
COMMENT ON COLUMN agent_policies.last_qbr_at IS 'Timestamp of last QBR execution';

COMMENT ON COLUMN agent_runtime_state.current_round IS 'Current simulation round number';
COMMENT ON COLUMN agent_runtime_state.consecutive_losses IS 'Consecutive auction losses (triggers exception)';
COMMENT ON COLUMN agent_runtime_state.consecutive_wins IS 'Consecutive auction wins (tracks momentum)';
COMMENT ON COLUMN agent_runtime_state.win_rate_last_20 IS 'Win rate over last 20 bids (0.0000 to 1.0000)';
COMMENT ON COLUMN agent_runtime_state.reputation_at_last_check IS 'Reputation value at last exception check (to detect drops)';
COMMENT ON COLUMN agent_runtime_state.win_rate_at_last_check IS 'Win rate at last exception check (to detect drops)';
COMMENT ON COLUMN agent_runtime_state.is_running IS 'Whether this agent is active in the runtime';

COMMENT ON COLUMN investor_updates.trigger_type IS 'What caused this brain wake-up (qbr/exception/novel/initial)';
COMMENT ON COLUMN investor_updates.observations IS 'Array of observation strings from brain analysis';
COMMENT ON COLUMN investor_updates.changes IS 'Array of {category, description, reasoning} policy changes';
COMMENT ON COLUMN investor_updates.survival_impact IS 'How these changes help agent survival';
COMMENT ON COLUMN investor_updates.growth_impact IS 'How these changes help agent growth';
COMMENT ON COLUMN investor_updates.runway_rounds IS 'Estimated rounds until balance reaches zero';
COMMENT ON COLUMN investor_updates.policy_version_before IS 'Policy version before this update';
COMMENT ON COLUMN investor_updates.policy_version_after IS 'Policy version after this update';
