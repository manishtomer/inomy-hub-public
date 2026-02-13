-- Add global LLM model selection to simulation_state
-- This column controls which Gemini model is used across all LLM calls
-- (agent brain, memory narrator, report generation)

ALTER TABLE simulation_state
ADD COLUMN IF NOT EXISTS llm_model TEXT DEFAULT 'gemini-2.5-flash-lite';

-- Update existing row
UPDATE simulation_state SET llm_model = 'gemini-2.5-flash-lite' WHERE id = 'global' AND llm_model IS NULL;
