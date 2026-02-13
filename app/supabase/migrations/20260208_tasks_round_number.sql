-- Add round_number to tasks table so we can reconstruct which tasks belong to which round
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS round_number INTEGER;
CREATE INDEX IF NOT EXISTS idx_tasks_round_number ON tasks(round_number);
