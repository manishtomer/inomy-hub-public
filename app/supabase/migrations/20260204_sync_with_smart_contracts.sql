-- Migration: Sync Database Schema with Smart Contracts
-- Date: 2026-02-04
-- Purpose: Align database schema with AgentRegistry, AgentToken, TaskAuction, IntentAuction contracts
--
-- Run this in Supabase SQL Editor

-- ============================================================================
-- 1. UPDATE AGENTS TABLE - Add missing fields from AgentRegistry contract
-- ============================================================================

-- Add owner wallet (who owns the agent, separate from agent's operating wallet)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_wallet VARCHAR(42);

-- Add token address (the AgentToken contract address for this agent)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS token_address VARCHAR(42);

-- Add metadata URI (IPFS or HTTP URL pointing to agent metadata JSON)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS metadata_uri TEXT;

-- Add total revenue (lifetime earnings in MON, from smart contract)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS total_revenue NUMERIC DEFAULT 0;

-- Add chain agent ID (the uint256 ID from the AgentRegistry contract)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS chain_agent_id BIGINT UNIQUE;

-- Add investor share basis points (5000-9500, represents % of profits to investors)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS investor_share_bps INTEGER DEFAULT 7500;

-- Add last synced block for chain sync tracking
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_synced_block BIGINT DEFAULT 0;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_agents_chain_agent_id ON agents(chain_agent_id);
CREATE INDEX IF NOT EXISTS idx_agents_token_address ON agents(token_address);
CREATE INDEX IF NOT EXISTS idx_agents_owner_wallet ON agents(owner_wallet);

-- ============================================================================
-- 2. FIX AGENT STATUS - Add PAUSED status constraint
-- ============================================================================

ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_status_check;
ALTER TABLE agents ADD CONSTRAINT agents_status_check
  CHECK (status IN ('UNFUNDED', 'ACTIVE', 'LOW_FUNDS', 'PAUSED', 'DEAD'));

-- ============================================================================
-- 3. UPDATE TASKS TABLE - Add missing fields from TaskAuction contract
-- ============================================================================

-- Add consumer address (who posted the task)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS consumer_address VARCHAR(42);

-- Add completion timestamp
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;

-- Add winning bid ID (references bids_cache - will add FK after table is created)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS winning_bid_id UUID;

-- Add chain task ID (the uint256 ID from TaskAuction contract)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS chain_task_id BIGINT UNIQUE;

-- Add metadata URI (IPFS or HTTP URL for detailed task requirements)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metadata_uri TEXT;

-- Add last synced block
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_synced_block BIGINT DEFAULT 0;

-- Create index for chain task ID lookups
CREATE INDEX IF NOT EXISTS idx_tasks_chain_task_id ON tasks(chain_task_id);

-- ============================================================================
-- 4. FIX TASK STATUS - Add VERIFIED, DISPUTED
-- ============================================================================

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'DISPUTED', 'FAILED', 'CANCELLED'));

-- ============================================================================
-- 5. UPDATE INTENTS TABLE - Add missing fields from IntentAuction contract
-- ============================================================================

-- Add consumer address (who posted the intent)
ALTER TABLE intents ADD COLUMN IF NOT EXISTS consumer_address VARCHAR(42);

-- Add tags array for matching
ALTER TABLE intents ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- Add accepted offer ID (will reference offers_cache after creation)
ALTER TABLE intents ADD COLUMN IF NOT EXISTS accepted_offer_id UUID;

-- Add expiration timestamp
ALTER TABLE intents ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

-- Add chain intent ID (the uint256 ID from IntentAuction contract)
ALTER TABLE intents ADD COLUMN IF NOT EXISTS chain_intent_id BIGINT UNIQUE;

-- Add last synced block
ALTER TABLE intents ADD COLUMN IF NOT EXISTS last_synced_block BIGINT DEFAULT 0;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_intents_chain_intent_id ON intents(chain_intent_id);
CREATE INDEX IF NOT EXISTS idx_intents_tags ON intents USING GIN(tags);

-- ============================================================================
-- 6. FIX INTENT STATUS - Add OPEN, FULFILLED, CONFIRMED, DISPUTED, EXPIRED
-- ============================================================================

ALTER TABLE intents DROP CONSTRAINT IF EXISTS intents_status_check;
ALTER TABLE intents ADD CONSTRAINT intents_status_check
  CHECK (status IN ('PENDING', 'OPEN', 'MATCHED', 'IN_PROGRESS', 'FULFILLED', 'CONFIRMED', 'COMPLETED', 'DISPUTED', 'EXPIRED', 'CANCELLED'));

-- ============================================================================
-- 7. CREATE INVESTORS TABLE (if not exists)
-- ============================================================================

CREATE TABLE IF NOT EXISTS investors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  wallet_address VARCHAR(42) NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investors_wallet ON investors(wallet_address);

-- ============================================================================
-- 8. CREATE TOKEN_HOLDINGS_CACHE TABLE (if not exists)
-- ============================================================================

CREATE TABLE IF NOT EXISTS token_holdings_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_wallet VARCHAR(42) NOT NULL,
  agent_wallet VARCHAR(42) NOT NULL,
  agent_id UUID REFERENCES agents(id),
  token_balance NUMERIC DEFAULT 0,
  total_invested NUMERIC DEFAULT 0,
  current_value NUMERIC DEFAULT 0,
  unrealized_pnl NUMERIC DEFAULT 0,
  unclaimed_dividends NUMERIC DEFAULT 0,
  last_synced_block BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(investor_wallet, agent_wallet)
);

CREATE INDEX IF NOT EXISTS idx_token_holdings_investor ON token_holdings_cache(investor_wallet);
CREATE INDEX IF NOT EXISTS idx_token_holdings_agent ON token_holdings_cache(agent_wallet);

-- If table already exists, add missing columns
ALTER TABLE token_holdings_cache ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id);
ALTER TABLE token_holdings_cache ADD COLUMN IF NOT EXISTS current_value NUMERIC DEFAULT 0;
ALTER TABLE token_holdings_cache ADD COLUMN IF NOT EXISTS unrealized_pnl NUMERIC DEFAULT 0;
ALTER TABLE token_holdings_cache ADD COLUMN IF NOT EXISTS unclaimed_dividends NUMERIC DEFAULT 0;

-- ============================================================================
-- 9. CREATE ECONOMY_EVENTS TABLE (if not exists)
-- ============================================================================

CREATE TABLE IF NOT EXISTS economy_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  agent_wallets TEXT[] DEFAULT '{}',
  investor_wallet VARCHAR(42),
  amount NUMERIC,
  tx_hash VARCHAR(66),
  block_number BIGINT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT economy_events_type_check CHECK (
    event_type IN ('task_completed', 'investment', 'partnership', 'agent_death',
                   'auction_won', 'policy_change', 'dividend_paid', 'token_bought',
                   'token_sold', 'reputation_changed')
  )
);

CREATE INDEX IF NOT EXISTS idx_economy_events_type ON economy_events(event_type);
CREATE INDEX IF NOT EXISTS idx_economy_events_created ON economy_events(created_at);

-- ============================================================================
-- 10. CREATE PARTNERSHIPS_CACHE TABLE (if not exists)
-- ============================================================================

CREATE TABLE IF NOT EXISTS partnerships_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_address VARCHAR(42),
  partner_a_wallet VARCHAR(42) NOT NULL,
  partner_b_wallet VARCHAR(42) NOT NULL,
  split_a INTEGER NOT NULL CHECK (split_a >= 0 AND split_a <= 100),
  split_b INTEGER NOT NULL CHECK (split_b >= 0 AND split_b <= 100),
  balance NUMERIC DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'PROPOSED',
  last_synced_block BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT partnerships_cache_status_check
    CHECK (status IN ('PROPOSED', 'NEGOTIATING', 'ACTIVE', 'DISSOLVED'))
);

CREATE INDEX IF NOT EXISTS idx_partnerships_partner_a ON partnerships_cache(partner_a_wallet);
CREATE INDEX IF NOT EXISTS idx_partnerships_partner_b ON partnerships_cache(partner_b_wallet);

-- ============================================================================
-- 11. CREATE BIDS_CACHE TABLE (if not exists)
-- ============================================================================

CREATE TABLE IF NOT EXISTS bids_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_bid_id BIGINT,
  chain_task_id BIGINT,
  task_id UUID REFERENCES tasks(id),
  agent_id UUID REFERENCES agents(id),
  bidder_wallet VARCHAR(42) NOT NULL,
  amount NUMERIC NOT NULL,
  estimated_duration BIGINT,
  proposal_uri TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  last_synced_block BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT bids_cache_status_check
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'WON', 'LOST'))
);

CREATE INDEX IF NOT EXISTS idx_bids_cache_task ON bids_cache(task_id);
CREATE INDEX IF NOT EXISTS idx_bids_cache_agent ON bids_cache(agent_id);
CREATE INDEX IF NOT EXISTS idx_bids_cache_bidder ON bids_cache(bidder_wallet);

-- ============================================================================
-- 12. CREATE OFFERS_CACHE TABLE - For IntentAuction offers
-- ============================================================================

CREATE TABLE IF NOT EXISTS offers_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_offer_id BIGINT UNIQUE,
  chain_intent_id BIGINT NOT NULL,
  intent_id UUID REFERENCES intents(id),
  agent_id UUID REFERENCES agents(id),
  agent_wallet VARCHAR(42) NOT NULL,
  price NUMERIC NOT NULL,
  proposal_text TEXT,
  matched_tags TEXT[] DEFAULT '{}',
  relevance_score INTEGER DEFAULT 0 CHECK (relevance_score >= 0 AND relevance_score <= 1000),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_synced_block BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT offers_cache_status_check
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'))
);

CREATE INDEX IF NOT EXISTS idx_offers_cache_intent ON offers_cache(intent_id);
CREATE INDEX IF NOT EXISTS idx_offers_cache_agent ON offers_cache(agent_id);
CREATE INDEX IF NOT EXISTS idx_offers_cache_chain_intent ON offers_cache(chain_intent_id);

-- ============================================================================
-- 13. CREATE DIVIDENDS_HISTORY TABLE - Track profit distributions
-- ============================================================================

CREATE TABLE IF NOT EXISTS dividends_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id),
  agent_wallet VARCHAR(42) NOT NULL,
  total_amount NUMERIC NOT NULL,
  investor_share NUMERIC NOT NULL,
  agent_share NUMERIC NOT NULL,
  total_supply_at_distribution NUMERIC,
  tx_hash VARCHAR(66),
  block_number BIGINT,
  distributed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dividends_history_agent ON dividends_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_dividends_history_wallet ON dividends_history(agent_wallet);
CREATE INDEX IF NOT EXISTS idx_dividends_history_distributed ON dividends_history(distributed_at);

-- ============================================================================
-- 14. CREATE DIVIDEND_CLAIMS TABLE - Track individual investor claims
-- ============================================================================

CREATE TABLE IF NOT EXISTS dividend_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dividend_id UUID REFERENCES dividends_history(id),
  investor_wallet VARCHAR(42) NOT NULL,
  agent_wallet VARCHAR(42) NOT NULL,
  amount NUMERIC NOT NULL,
  token_balance_at_claim NUMERIC,
  tx_hash VARCHAR(66),
  block_number BIGINT,
  claimed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dividend_claims_investor ON dividend_claims(investor_wallet);
CREATE INDEX IF NOT EXISTS idx_dividend_claims_agent ON dividend_claims(agent_wallet);

-- ============================================================================
-- 15. CREATE REPUTATION_HISTORY TABLE - Track reputation changes
-- ============================================================================

CREATE TABLE IF NOT EXISTS reputation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id),
  agent_wallet VARCHAR(42) NOT NULL,
  old_reputation INTEGER NOT NULL,
  new_reputation INTEGER NOT NULL,
  change_amount INTEGER NOT NULL,
  reason VARCHAR(50),
  tx_hash VARCHAR(66),
  block_number BIGINT,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reputation_history_agent ON reputation_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_reputation_history_changed ON reputation_history(changed_at);

-- ============================================================================
-- 16. CREATE TOKEN_TRANSACTIONS TABLE - Track buy/sell on bonding curve
-- ============================================================================

CREATE TABLE IF NOT EXISTS token_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id),
  agent_wallet VARCHAR(42) NOT NULL,
  investor_wallet VARCHAR(42) NOT NULL,
  transaction_type VARCHAR(10) NOT NULL,
  token_amount NUMERIC NOT NULL,
  mon_amount NUMERIC NOT NULL,
  protocol_fee NUMERIC,
  price_at_transaction NUMERIC,
  supply_after_transaction NUMERIC,
  tx_hash VARCHAR(66),
  block_number BIGINT,
  transacted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT token_transactions_type_check
    CHECK (transaction_type IN ('BUY', 'SELL'))
);

CREATE INDEX IF NOT EXISTS idx_token_transactions_agent ON token_transactions(agent_id);
CREATE INDEX IF NOT EXISTS idx_token_transactions_investor ON token_transactions(investor_wallet);
CREATE INDEX IF NOT EXISTS idx_token_transactions_type ON token_transactions(transaction_type);

-- ============================================================================
-- 17. ADD FOREIGN KEY FOR WINNING BID (now that bids_cache exists)
-- ============================================================================

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_winning_bid_fk;
ALTER TABLE tasks ADD CONSTRAINT tasks_winning_bid_fk
  FOREIGN KEY (winning_bid_id) REFERENCES bids_cache(id);

-- ============================================================================
-- 18. CREATE PROTOCOL_STATS TABLE - Track protocol-wide statistics
-- ============================================================================

CREATE TABLE IF NOT EXISTS protocol_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_date DATE NOT NULL UNIQUE,
  total_agents INTEGER DEFAULT 0,
  active_agents INTEGER DEFAULT 0,
  total_tasks_created INTEGER DEFAULT 0,
  total_tasks_completed INTEGER DEFAULT 0,
  total_intents_created INTEGER DEFAULT 0,
  total_intents_fulfilled INTEGER DEFAULT 0,
  total_volume_mon NUMERIC DEFAULT 0,
  total_fees_collected_mon NUMERIC DEFAULT 0,
  total_dividends_distributed_mon NUMERIC DEFAULT 0,
  average_reputation NUMERIC DEFAULT 500,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_protocol_stats_date ON protocol_stats(stat_date);

-- ============================================================================
-- 19. CREATE CHAIN_SYNC_STATE TABLE - Track sync progress per contract
-- ============================================================================

CREATE TABLE IF NOT EXISTS chain_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_name VARCHAR(50) NOT NULL UNIQUE,
  contract_address VARCHAR(42) NOT NULL,
  last_synced_block BIGINT NOT NULL DEFAULT 0,
  last_sync_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sync_status VARCHAR(20) DEFAULT 'idle',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT chain_sync_state_status_check
    CHECK (sync_status IN ('idle', 'syncing', 'error'))
);

-- Insert initial contract entries (update addresses after deployment)
INSERT INTO chain_sync_state (contract_name, contract_address, last_synced_block)
VALUES
  ('AgentRegistry', '0x0000000000000000000000000000000000000000', 0),
  ('TaskAuction', '0x0000000000000000000000000000000000000000', 0),
  ('IntentAuction', '0x0000000000000000000000000000000000000000', 0),
  ('Partnership', '0x0000000000000000000000000000000000000000', 0),
  ('Treasury', '0x0000000000000000000000000000000000000000', 0)
ON CONFLICT (contract_name) DO NOTHING;

-- ============================================================================
-- DONE! Verify with:
-- ============================================================================
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'agents' ORDER BY ordinal_position;
