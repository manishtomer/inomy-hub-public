-- Brain cooldown + policy change tracking
-- Adds columns to agent_runtime_state for:
-- 1. Brain wakeup cooldown (last_brain_wakeup_round)
-- 2. Policy change tracking (last_policy_change_round + metrics snapshot)

ALTER TABLE agent_runtime_state
  ADD COLUMN IF NOT EXISTS last_brain_wakeup_round integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_policy_change_round integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_at_last_change jsonb DEFAULT NULL;

COMMENT ON COLUMN agent_runtime_state.last_brain_wakeup_round IS 'Round when brain last woke up. Used for 5-round cooldown between wakeups.';
COMMENT ON COLUMN agent_runtime_state.last_policy_change_round IS 'Round when policy was last changed. Used for "since last change" context.';
COMMENT ON COLUMN agent_runtime_state.metrics_at_last_change IS 'Snapshot of win_rate, balance, consecutive_losses, target_margin at last policy change.';
