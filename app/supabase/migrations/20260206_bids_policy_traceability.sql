-- ============================================================================
-- ADD POLICY TRACEABILITY TO BIDS
-- ============================================================================
-- This migration adds a column to bids_cache to store the policy values
-- that were used when generating each bid, providing proof that brain
-- policy changes are actually being followed in subsequent bids.
-- ============================================================================

-- Add policy_used column to store the margins and policy source used for bid
ALTER TABLE bids_cache ADD COLUMN IF NOT EXISTS policy_used JSONB;

-- Example structure of policy_used:
-- {
--   "source": "brain_policy" | "personality_default",
--   "margin_range": { "min": 0.03, "max": 0.08 },
--   "actual_margin": 0.055,
--   "skip_below_profit": 0.002,
--   "survival_mode": "growth"
-- }

COMMENT ON COLUMN bids_cache.policy_used IS
  'JSON storing the policy values used to generate this bid, for traceability';
