-- Migration: Add chain sync columns to partnerships_cache
-- Date: 2026-02-05
-- Purpose: Align partnerships_cache table with chain sync processor expectations
--
-- The chain sync Partnership processor writes chain-specific fields that the
-- original table schema didn't include. This migration adds those columns
-- while keeping the existing columns for backward compatibility.

-- ============================================================================
-- 1. ADD CHAIN-SPECIFIC COLUMNS TO PARTNERSHIPS_CACHE
-- ============================================================================

-- Chain IDs for linking to on-chain data
ALTER TABLE partnerships_cache ADD COLUMN IF NOT EXISTS chain_proposal_id BIGINT;
ALTER TABLE partnerships_cache ADD COLUMN IF NOT EXISTS chain_partnership_id BIGINT;

-- Agent UUIDs (references agents table)
ALTER TABLE partnerships_cache ADD COLUMN IF NOT EXISTS agent1_id UUID REFERENCES agents(id);
ALTER TABLE partnerships_cache ADD COLUMN IF NOT EXISTS agent2_id UUID REFERENCES agents(id);

-- Chain agent IDs (uint256 from AgentRegistry)
ALTER TABLE partnerships_cache ADD COLUMN IF NOT EXISTS agent1_chain_id BIGINT;
ALTER TABLE partnerships_cache ADD COLUMN IF NOT EXISTS agent2_chain_id BIGINT;

-- Agent splits (basis points from contract, maps to split_a/split_b for display)
ALTER TABLE partnerships_cache ADD COLUMN IF NOT EXISTS agent1_split INTEGER;
ALTER TABLE partnerships_cache ADD COLUMN IF NOT EXISTS agent2_split INTEGER;

-- Revenue tracking
ALTER TABLE partnerships_cache ADD COLUMN IF NOT EXISTS total_revenue NUMERIC DEFAULT 0;

-- Expiration timestamp
ALTER TABLE partnerships_cache ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

-- Make partner_a_wallet and partner_b_wallet nullable (chain sync uses agent1_id/agent2_id)
ALTER TABLE partnerships_cache ALTER COLUMN partner_a_wallet DROP NOT NULL;
ALTER TABLE partnerships_cache ALTER COLUMN partner_b_wallet DROP NOT NULL;

-- Drop the split constraints that require NOT NULL (chain sync uses agent1_split/agent2_split)
ALTER TABLE partnerships_cache DROP CONSTRAINT IF EXISTS partnerships_cache_split_a_check;
ALTER TABLE partnerships_cache DROP CONSTRAINT IF EXISTS partnerships_cache_split_b_check;
ALTER TABLE partnerships_cache ALTER COLUMN split_a DROP NOT NULL;
ALTER TABLE partnerships_cache ALTER COLUMN split_b DROP NOT NULL;

-- Add REJECTED status (used by ProposalRejected event)
ALTER TABLE partnerships_cache DROP CONSTRAINT IF EXISTS partnerships_cache_status_check;
ALTER TABLE partnerships_cache ADD CONSTRAINT partnerships_cache_status_check
  CHECK (status IN ('PROPOSED', 'NEGOTIATING', 'ACTIVE', 'DISSOLVED', 'REJECTED'));

-- ============================================================================
-- 2. ADD INDEXES FOR CHAIN SYNC LOOKUPS
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_partnerships_chain_proposal ON partnerships_cache(chain_proposal_id) WHERE chain_proposal_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_partnerships_chain_partnership ON partnerships_cache(chain_partnership_id) WHERE chain_partnership_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partnerships_agent1 ON partnerships_cache(agent1_id);
CREATE INDEX IF NOT EXISTS idx_partnerships_agent2 ON partnerships_cache(agent2_id);

-- ============================================================================
-- 3. CREATE TRIGGER TO SYNC OLD/NEW COLUMNS
-- ============================================================================

-- When chain sync inserts using agent1_id/agent2_id, auto-populate partner_a_wallet/partner_b_wallet
CREATE OR REPLACE FUNCTION sync_partnership_wallets()
RETURNS TRIGGER AS $$
BEGIN
  -- If agent1_id is set but partner_a_wallet is not, look up wallet
  IF NEW.agent1_id IS NOT NULL AND NEW.partner_a_wallet IS NULL THEN
    SELECT wallet_address INTO NEW.partner_a_wallet
    FROM agents WHERE id = NEW.agent1_id;
  END IF;

  IF NEW.agent2_id IS NOT NULL AND NEW.partner_b_wallet IS NULL THEN
    SELECT wallet_address INTO NEW.partner_b_wallet
    FROM agents WHERE id = NEW.agent2_id;
  END IF;

  -- Sync splits
  IF NEW.agent1_split IS NOT NULL AND NEW.split_a IS NULL THEN
    NEW.split_a := NEW.agent1_split;
  END IF;

  IF NEW.agent2_split IS NOT NULL AND NEW.split_b IS NULL THEN
    NEW.split_b := NEW.agent2_split;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_partnership_wallets ON partnerships_cache;
CREATE TRIGGER trg_sync_partnership_wallets
  BEFORE INSERT OR UPDATE ON partnerships_cache
  FOR EACH ROW
  EXECUTE FUNCTION sync_partnership_wallets();

-- ============================================================================
-- DONE! partnerships_cache now supports both old and new column patterns
-- ============================================================================
