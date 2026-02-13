-- Replace single llm_model TEXT with per-activity llm_models JSONB
-- Each of the 5 LLM activities can now use a different Gemini model

-- Step 1: Add the new JSONB column
ALTER TABLE simulation_state
ADD COLUMN IF NOT EXISTS llm_models JSONB;

-- Step 2: Migrate existing llm_model value into all 5 activity keys
UPDATE simulation_state
SET llm_models = jsonb_build_object(
  'narrator',  COALESCE(llm_model, 'gemini-2.5-flash-lite'),
  'brain',     COALESCE(llm_model, 'gemini-2.5-flash-lite'),
  'qbr',       COALESCE(llm_model, 'gemini-2.5-flash-lite'),
  'exception', COALESCE(llm_model, 'gemini-2.5-flash-lite'),
  'reports',   COALESCE(llm_model, 'gemini-2.5-flash-lite')
)
WHERE id = 'global';

-- Step 3: Set default for the column
ALTER TABLE simulation_state
ALTER COLUMN llm_models SET DEFAULT '{"narrator":"gemini-2.5-flash-lite","brain":"gemini-2.5-flash-lite","qbr":"gemini-2.5-flash-lite","exception":"gemini-2.5-flash-lite","reports":"gemini-2.5-flash-lite"}'::jsonb;

-- Step 4: Drop the old single-value column
ALTER TABLE simulation_state DROP COLUMN IF EXISTS llm_model;
