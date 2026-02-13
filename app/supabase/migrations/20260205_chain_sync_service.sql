-- Chain Sync Service Migration
-- Date: 2026-02-05
-- Purpose: Create tables and seed data for blockchain event synchronization

-- ============================================================================
-- 1. SEED CHAIN_SYNC_STATE WITH REAL CONTRACT ADDRESSES
-- ============================================================================

-- Update with real deployed contract addresses
UPDATE chain_sync_state SET contract_address = '0xe7dAD10C1274c9E6bb885b36c617b0d310DEF199' WHERE contract_name = 'AgentRegistry';
UPDATE chain_sync_state SET contract_address = '0x96dF572c3242631d3Cff4EbCb640971cfb96F833' WHERE contract_name = 'TaskAuction';
UPDATE chain_sync_state SET contract_address = '0x48ECD487a9FE688a2904188549a5117def49207e' WHERE contract_name = 'IntentAuction';
UPDATE chain_sync_state SET contract_address = '0xE73655CEb012795CE82E5e92aa50FF9D09eEB0fd' WHERE contract_name = 'Partnership';
UPDATE chain_sync_state SET contract_address = '0x8723Ab32451C9114143b9784c885fd7eBdBBC490' WHERE contract_name = 'Treasury';

-- ============================================================================
-- 2. CREATE AGENT_TOKEN_ADDRESSES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_token_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  chain_agent_id BIGINT NOT NULL,
  token_address VARCHAR(42) NOT NULL UNIQUE,
  created_at_block BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_token_addresses_agent_id ON agent_token_addresses(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_token_addresses_chain_agent_id ON agent_token_addresses(chain_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_token_addresses_token ON agent_token_addresses(token_address);

COMMENT ON TABLE agent_token_addresses IS 'Maps agents to their bonding curve token contract addresses (synced from AgentRegistry events)';
COMMENT ON COLUMN agent_token_addresses.chain_agent_id IS 'The uint256 agent ID from AgentRegistry contract';
COMMENT ON COLUMN agent_token_addresses.token_address IS 'The AgentToken contract address for this agent';
COMMENT ON COLUMN agent_token_addresses.created_at_block IS 'Block number when agent was registered on-chain';

-- ============================================================================
-- 3. ADD UNIQUE CONSTRAINT ON ECONOMY_EVENTS FOR DEDUPLICATION
-- ============================================================================

-- Ensure we don't duplicate events by tx_hash + block_number
CREATE UNIQUE INDEX IF NOT EXISTS idx_economy_events_dedup
  ON economy_events(tx_hash, block_number)
  WHERE tx_hash IS NOT NULL AND block_number IS NOT NULL;

COMMENT ON INDEX idx_economy_events_dedup IS 'Prevents duplicate economy events from the same transaction';

-- ============================================================================
-- 4. ENHANCE TOKEN_TRANSACTIONS TABLE
-- ============================================================================

-- Add unique constraint for deduplication (one transaction per tx_hash + log_index)
-- Note: We'll use tx_hash + investor_wallet + transaction_type as dedup key
-- since multiple buys/sells can happen in same transaction
CREATE UNIQUE INDEX IF NOT EXISTS idx_token_transactions_dedup
  ON token_transactions(tx_hash, investor_wallet, transaction_type)
  WHERE tx_hash IS NOT NULL;

-- Add index on token address for fast lookups
ALTER TABLE token_transactions ADD COLUMN IF NOT EXISTS token_address VARCHAR(42);
CREATE INDEX IF NOT EXISTS idx_token_transactions_token ON token_transactions(token_address);

COMMENT ON COLUMN token_transactions.token_address IS 'AgentToken contract address (for faster lookups)';

-- ============================================================================
-- DONE! Schema ready for chain sync service
-- ============================================================================
