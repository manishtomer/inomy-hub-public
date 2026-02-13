-- ============================================================================
-- UI Implementation: Economy Dashboard Tables
-- Created: 2026-02-04
-- Description: Tables for investors, token holdings, economy events,
--              partnerships, and bids. Follows database-blockchain architecture.
-- ============================================================================

-- ============================================================================
-- OFF-CHAIN TABLES (Not on blockchain)
-- ============================================================================

-- Human investor profiles, linked to chain by wallet address
CREATE TABLE IF NOT EXISTS investors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR NOT NULL,
  wallet_address VARCHAR UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create index for wallet lookups
CREATE INDEX IF NOT EXISTS idx_investors_wallet ON investors(wallet_address);

-- ============================================================================
-- CHAIN-SYNCED CACHE TABLES (Source of truth is blockchain)
-- ============================================================================

-- Cached from AgentToken contract holdings
-- Replaces "investments" concept with token ownership
CREATE TABLE IF NOT EXISTS token_holdings_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investor_wallet VARCHAR NOT NULL,
  agent_wallet VARCHAR NOT NULL,
  token_balance NUMERIC NOT NULL DEFAULT 0,
  total_invested NUMERIC NOT NULL DEFAULT 0,
  last_synced_block BIGINT NOT NULL DEFAULT 0,
  UNIQUE(investor_wallet, agent_wallet)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_holdings_investor ON token_holdings_cache(investor_wallet);
CREATE INDEX IF NOT EXISTS idx_holdings_agent ON token_holdings_cache(agent_wallet);

-- Generated from chain events + off-chain actions for activity feed
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
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create index for activity feed queries (most recent first)
CREATE INDEX IF NOT EXISTS idx_economy_events_created_at ON economy_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_economy_events_type ON economy_events(event_type);

-- Cached from Partnership contract
CREATE TABLE IF NOT EXISTS partnerships_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partnership_address VARCHAR UNIQUE,
  partner_a_wallet VARCHAR NOT NULL,
  partner_b_wallet VARCHAR NOT NULL,
  split_a INTEGER NOT NULL CHECK (split_a >= 0 AND split_a <= 100),
  split_b INTEGER NOT NULL CHECK (split_b >= 0 AND split_b <= 100),
  balance NUMERIC NOT NULL DEFAULT 0,
  status VARCHAR NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
    'PROPOSED',
    'NEGOTIATING',
    'ACTIVE',
    'DISSOLVED'
  )),
  last_synced_block BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  CHECK (split_a + split_b = 100)
);

-- Create indexes for partnership queries
CREATE INDEX IF NOT EXISTS idx_partnerships_partner_a ON partnerships_cache(partner_a_wallet);
CREATE INDEX IF NOT EXISTS idx_partnerships_partner_b ON partnerships_cache(partner_b_wallet);
CREATE INDEX IF NOT EXISTS idx_partnerships_status ON partnerships_cache(status);

-- Cached from TaskAuction contract bids
CREATE TABLE IF NOT EXISTS bids_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chain_task_id INTEGER,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  bidder_wallet VARCHAR NOT NULL,
  amount NUMERIC NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING',
    'WON',
    'LOST'
  )),
  last_synced_block BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(task_id, bidder_wallet)
);

-- Create indexes for bid queries
CREATE INDEX IF NOT EXISTS idx_bids_task ON bids_cache(task_id);
CREATE INDEX IF NOT EXISTS idx_bids_bidder ON bids_cache(bidder_wallet);
CREATE INDEX IF NOT EXISTS idx_bids_status ON bids_cache(status);

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE investors IS 'Human investor profiles linked to blockchain by wallet address';
COMMENT ON TABLE token_holdings_cache IS 'Cached token ownership from AgentToken contract';
COMMENT ON TABLE economy_events IS 'Activity feed events from chain and off-chain actions';
COMMENT ON TABLE partnerships_cache IS 'Cached agent partnerships from Partnership contract';
COMMENT ON TABLE bids_cache IS 'Cached task auction bids from TaskAuction contract';

COMMENT ON COLUMN token_holdings_cache.last_synced_block IS 'Last blockchain block synced for this holding';
COMMENT ON COLUMN economy_events.agent_wallets IS 'Array of agent wallet addresses involved in this event';
COMMENT ON COLUMN partnerships_cache.split_a IS 'Partner A revenue split percentage (0-100)';
COMMENT ON COLUMN partnerships_cache.split_b IS 'Partner B revenue split percentage (0-100)';
COMMENT ON COLUMN bids_cache.chain_task_id IS 'Task ID from blockchain (null in demo mode)';
