-- Add missing agent_id column to bids_cache.
-- The original migration (20260204_create_economy_tables.sql) created the table
-- without agent_id. A later CREATE TABLE IF NOT EXISTS included it but was a no-op
-- since the table already existed. The application code writes agent_id on every
-- bid insert, but the column didn't exist so it was silently dropped — causing
-- selectWinner() to fail (0 wins, $0 revenue).

ALTER TABLE bids_cache
ADD COLUMN IF NOT EXISTS agent_id TEXT REFERENCES agents(id);

-- Index for fast lookups when resolving auctions
CREATE INDEX IF NOT EXISTS idx_bids_cache_agent_id ON bids_cache(agent_id);
