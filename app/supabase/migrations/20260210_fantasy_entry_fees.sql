-- ============================================================================
-- Fantasy Tournaments - Entry Fees & Payouts
--
-- Adds entry_fee and prize_pool to tournaments.
-- Adds payout_amount to teams so winners know what they earned.
-- ============================================================================

-- Entry fee set by tournament creator (USDC amount per team)
ALTER TABLE fantasy_tournaments ADD COLUMN IF NOT EXISTS entry_fee NUMERIC(12, 4) NOT NULL DEFAULT 0;

-- Prize pool = entry_fee * number of teams (accumulated on join)
ALTER TABLE fantasy_tournaments ADD COLUMN IF NOT EXISTS prize_pool NUMERIC(12, 4) NOT NULL DEFAULT 0;

-- How much each team receives on completion (0 if not a winner)
ALTER TABLE fantasy_teams ADD COLUMN IF NOT EXISTS payout_amount NUMERIC(12, 4) NOT NULL DEFAULT 0;
