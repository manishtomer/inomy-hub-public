-- Add total_policy_changes counter to agent_runtime_state
-- Incremented once per brain wakeup that results in a policy change.
-- Invariant: total_policy_changes <= total_brain_wakeups (always).
--
-- No backfill: historical brain_decision events are inconsistent
-- (varying code paths, multiple events per wakeup, etc.).
-- Counter starts at 0 and accumulates accurately going forward.

ALTER TABLE agent_runtime_state
ADD COLUMN IF NOT EXISTS total_policy_changes INTEGER NOT NULL DEFAULT 0;
