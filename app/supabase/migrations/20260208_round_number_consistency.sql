-- Add round_number to bids_cache, exception_history, and economy_events
-- for consistent round-based filtering across all report queries.

-- ── Schema changes ──────────────────────────────────────────────────

ALTER TABLE bids_cache ADD COLUMN IF NOT EXISTS round_number INTEGER;
CREATE INDEX IF NOT EXISTS idx_bids_cache_round_number ON bids_cache (round_number);

ALTER TABLE exception_history ADD COLUMN IF NOT EXISTS round_number INTEGER;
CREATE INDEX IF NOT EXISTS idx_exception_history_round_number ON exception_history (round_number);

ALTER TABLE economy_events ADD COLUMN IF NOT EXISTS round_number INTEGER;
CREATE INDEX IF NOT EXISTS idx_economy_events_round_number ON economy_events (round_number);

-- ── Backfill chain: tasks → bids → economy_events ──────────────────

-- Step 1: Backfill tasks.round_number from agent_memories (bid_outcome memories
-- store task_id in data->>'task_id' and have exact round_number).
-- We take the MIN round in case of duplicates.
UPDATE tasks t
SET round_number = mem.round
FROM (
  SELECT (data->>'task_id')::uuid AS task_id, MIN(round_number) AS round
  FROM agent_memories
  WHERE memory_type IN ('bid_outcome', 'task_execution')
    AND data->>'task_id' IS NOT NULL
  GROUP BY (data->>'task_id')::uuid
) mem
WHERE t.id = mem.task_id
  AND t.round_number IS NULL;

-- Step 2: Backfill bids_cache.round_number from tasks (now that tasks have it)
UPDATE bids_cache b
SET round_number = t.round_number
FROM tasks t
WHERE b.task_id = t.id
  AND t.round_number IS NOT NULL
  AND b.round_number IS NULL;

-- Step 3: Backfill economy_events from metadata task references
UPDATE economy_events e
SET round_number = t.round_number
FROM tasks t
WHERE e.round_number IS NULL
  AND e.event_type = 'bid_placed'
  AND e.metadata->>'task_id' IS NOT NULL
  AND t.id = (e.metadata->>'task_id')::uuid
  AND t.round_number IS NOT NULL;

-- Step 4: Backfill economy_events brain_decision from metadata round if present
UPDATE economy_events
SET round_number = (metadata->>'round')::integer
WHERE round_number IS NULL
  AND metadata->>'round' IS NOT NULL;

-- Step 5: Backfill brain_decision events' round_number by matching with
-- the closest earlier exception_handled memory for the same agent.
-- Each brain_decision event is created seconds after its exception_handled memory.
UPDATE economy_events e
SET round_number = (
  SELECT m.round_number
  FROM agent_memories m
  JOIN agents a ON a.id = m.agent_id
  WHERE m.memory_type IN ('exception_handled', 'qbr_insight')
    AND a.wallet_address = e.agent_wallets[1]
    AND m.created_at <= e.created_at
  ORDER BY m.created_at DESC
  LIMIT 1
)
WHERE e.event_type = 'brain_decision'
  AND e.round_number IS NULL;
