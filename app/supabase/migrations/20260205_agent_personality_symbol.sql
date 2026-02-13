-- Migration: Add personality and token_symbol columns to agents table
-- Date: 2026-02-05
-- Purpose: Support agent personality selection and custom token symbols

-- Add personality column (default to 'balanced' for existing agents)
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS personality TEXT DEFAULT 'balanced';

-- Add token_symbol column
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS token_symbol TEXT;

-- Add check constraint for valid personality values
ALTER TABLE agents
ADD CONSTRAINT agents_personality_check
CHECK (personality IN ('conservative', 'balanced', 'aggressive', 'opportunistic'));

-- Add check constraint for token_symbol (max 6 chars, uppercase letters only)
ALTER TABLE agents
ADD CONSTRAINT agents_token_symbol_check
CHECK (token_symbol IS NULL OR (length(token_symbol) <= 6 AND token_symbol ~ '^[A-Z]+$'));

-- Create index on personality for filtering
CREATE INDEX IF NOT EXISTS idx_agents_personality ON agents(personality);

-- Comment on columns
COMMENT ON COLUMN agents.personality IS 'Agent behavioral profile: conservative, balanced, aggressive, or opportunistic';
COMMENT ON COLUMN agents.token_symbol IS 'Token ticker symbol for the agent bonding curve (max 6 chars, e.g., EBOT)';
