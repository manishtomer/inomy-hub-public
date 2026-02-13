-- Add PLATFORM to agents.type CHECK constraint
-- Required for the INOMY platform token to be stored in the agents table

-- Drop the existing constraint (auto-named by Supabase)
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_type_check;

-- Recreate with PLATFORM included
ALTER TABLE agents ADD CONSTRAINT agents_type_check
  CHECK (type IN ('CATALOG', 'REVIEW', 'CURATION', 'SELLER', 'PLATFORM'));
