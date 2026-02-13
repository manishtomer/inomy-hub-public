-- Migration: Economy Dashboard Tables
-- Created: 2026-02-04
-- Description: Creates 5 new tables for Phase 1 of Agent Economy Dashboard UI
--
-- Architecture Note: Tables follow the database-blockchain hybrid pattern:
--   - OFF-CHAIN: investors (stored only in DB)
--   - CHAIN-SYNCED: token_holdings_cache, partnerships_cache, bids_cache (synced from blockchain)
--   - COMPUTED: economy_events (generated from events)
--
-- For hackathon demo, DEMO_MODE=true means all operations are database-only.
-- When smart contracts are ready, chain writes will sync to these cache tables.

-- ============================================================================
-- 1. INVESTORS TABLE (OFF-CHAIN)
-- ============================================================================

CREATE TABLE IF NOT EXISTS investors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR NOT NULL,
  wallet_address VARCHAR UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_investors_wallet ON investors(wallet_address);

-- Comments
COMMENT ON TABLE investors IS 'Human investor profiles, linked to blockchain by wallet address (OFF-CHAIN)';
COMMENT ON COLUMN investors.wallet_address IS 'Blockchain wallet address - links to on-chain identity and holdings';

-- ============================================================================
-- 2. TOKEN_HOLDINGS_CACHE TABLE (CHAIN-SYNCED)
-- ============================================================================

CREATE TABLE IF NOT EXISTS token_holdings_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investor_wallet VARCHAR NOT NULL,
  agent_wallet VARCHAR NOT NULL,
  token_balance NUMERIC NOT NULL DEFAULT 0,
  total_invested NUMERIC NOT NULL DEFAULT 0,
  last_synced_block BIGINT NOT NULL DEFAULT 0,
  UNIQUE(investor_wallet, agent_wallet)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_token_holdings_investor ON token_holdings_cache(investor_wallet);
CREATE INDEX IF NOT EXISTS idx_token_holdings_agent ON token_holdings_cache(agent_wallet);

-- Comments
COMMENT ON TABLE token_holdings_cache IS 'Cached from AgentToken contract - investor ownership of agent tokens (CHAIN-SYNCED)';
COMMENT ON COLUMN token_holdings_cache.last_synced_block IS 'Last blockchain block number synced - used for event sync tracking';

-- ============================================================================
-- 3. ECONOMY_EVENTS TABLE (COMPUTED)
-- ============================================================================

CREATE TABLE IF NOT EXISTS economy_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type VARCHAR NOT NULL CHECK (event_type IN (
    'task_completed',
    'investment',
    'partnership',
    'agent_death',
    'auction_won',
    'policy_change',
    'dividend_paid'
  )),
  description TEXT NOT NULL,
  agent_wallets VARCHAR[],
  investor_wallet VARCHAR,
  amount NUMERIC,
  tx_hash VARCHAR,
  block_number BIGINT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_economy_events_created_at ON economy_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_economy_events_agent_wallets ON economy_events USING GIN(agent_wallets);
CREATE INDEX IF NOT EXISTS idx_economy_events_investor ON economy_events(investor_wallet);
CREATE INDEX IF NOT EXISTS idx_economy_events_type ON economy_events(event_type);

-- Comments
COMMENT ON TABLE economy_events IS 'Activity feed events generated from chain events and off-chain actions (COMPUTED)';
COMMENT ON COLUMN economy_events.agent_wallets IS 'Array of agent wallet addresses involved in the event';
COMMENT ON COLUMN economy_events.metadata IS 'Additional event-specific data stored as JSON';

-- ============================================================================
-- 4. PARTNERSHIPS_CACHE TABLE (CHAIN-SYNCED)
-- ============================================================================

CREATE TABLE IF NOT EXISTS partnerships_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partnership_address VARCHAR UNIQUE,
  partner_a_wallet VARCHAR NOT NULL,
  partner_b_wallet VARCHAR NOT NULL,
  split_a INTEGER NOT NULL CHECK (split_a >= 0 AND split_a <= 100),
  split_b INTEGER NOT NULL CHECK (split_b >= 0 AND split_b <= 100),
  balance NUMERIC NOT NULL DEFAULT 0,
  status VARCHAR NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PROPOSED', 'NEGOTIATING', 'ACTIVE', 'DISSOLVED')),
  last_synced_block BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT partnership_splits_sum CHECK (split_a + split_b = 100)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_partnerships_partner_a ON partnerships_cache(partner_a_wallet);
CREATE INDEX IF NOT EXISTS idx_partnerships_partner_b ON partnerships_cache(partner_b_wallet);
CREATE INDEX IF NOT EXISTS idx_partnerships_status ON partnerships_cache(status);

-- Comments
COMMENT ON TABLE partnerships_cache IS 'Cached from Partnership contract - agent partnerships with revenue splits (CHAIN-SYNCED)';
COMMENT ON COLUMN partnerships_cache.partnership_address IS 'Partnership contract address on blockchain (null in demo mode)';
COMMENT ON COLUMN partnerships_cache.split_a IS 'Partner A revenue split percentage (0-100)';
COMMENT ON COLUMN partnerships_cache.split_b IS 'Partner B revenue split percentage (0-100)';

-- ============================================================================
-- 5. BIDS_CACHE TABLE (CHAIN-SYNCED)
-- ============================================================================

CREATE TABLE IF NOT EXISTS bids_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chain_task_id INTEGER,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  bidder_wallet VARCHAR NOT NULL,
  amount NUMERIC NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'WON', 'LOST')),
  last_synced_block BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(task_id, bidder_wallet)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bids_task ON bids_cache(task_id);
CREATE INDEX IF NOT EXISTS idx_bids_bidder ON bids_cache(bidder_wallet);
CREATE INDEX IF NOT EXISTS idx_bids_status ON bids_cache(status);

-- Comments
COMMENT ON TABLE bids_cache IS 'Cached from TaskAuction contract - agent bids on tasks (CHAIN-SYNCED)';
COMMENT ON COLUMN bids_cache.chain_task_id IS 'Task ID from blockchain (null in demo mode)';
COMMENT ON COLUMN bids_cache.task_id IS 'Reference to local tasks table';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify tables created
DO $$
BEGIN
  RAISE NOTICE 'Migration 002 complete. Tables created:';
  RAISE NOTICE '  - investors (OFF-CHAIN)';
  RAISE NOTICE '  - token_holdings_cache (CHAIN-SYNCED)';
  RAISE NOTICE '  - economy_events (COMPUTED)';
  RAISE NOTICE '  - partnerships_cache (CHAIN-SYNCED)';
  RAISE NOTICE '  - bids_cache (CHAIN-SYNCED)';
END $$;

-- Show table sizes (should be 0 for new tables)
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename IN (
  'investors',
  'token_holdings_cache',
  'economy_events',
  'partnerships_cache',
  'bids_cache'
)
ORDER BY tablename;
