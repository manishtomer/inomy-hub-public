-- ============================================================================
-- Add Wallet Columns to Agents Table
-- Created: 2026-02-05
-- Description: Adds Privy wallet integration columns for agent embedded wallets
-- ============================================================================

-- Add wallet columns to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS wallet_address VARCHAR;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS privy_wallet_id VARCHAR;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS privy_user_id VARCHAR;

-- Create indexes for wallet lookups
CREATE INDEX IF NOT EXISTS idx_agents_wallet_address ON agents(wallet_address);
CREATE INDEX IF NOT EXISTS idx_agents_privy_user_id ON agents(privy_user_id);

-- Add comments for documentation
COMMENT ON COLUMN agents.wallet_address IS 'Privy embedded wallet address (hex format)';
COMMENT ON COLUMN agents.privy_wallet_id IS 'Privy internal wallet identifier';
COMMENT ON COLUMN agents.privy_user_id IS 'Privy user ID (did:privy:... format)';
