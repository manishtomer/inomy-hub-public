-- ============================================================================
-- Two-Layer Memory System
-- Created: 2026-02-06
-- Description: Industry memory (shared) and agent personal memories (individual)
--              with both structured data (JSONB) and LLM-written narratives (TEXT)
-- ============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- INDUSTRY MEMORY TABLE (Layer 1: Shared Market Events)
-- ============================================================================

CREATE TABLE IF NOT EXISTS industry_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Event classification
  round_number INTEGER NOT NULL,
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN (
    'market_crash',           -- Multiple agents died this round
    'price_compression',      -- Avg winning bids dropped significantly
    'demand_surge',           -- Task volume increased significantly
    'new_competitor_wave',    -- Multiple new agents of same type entered
    'partnership_trend',      -- Partnerships becoming more common
    'agent_death',            -- A specific agent died
    'market_shift'            -- General market condition change
  )),

  -- Structured data (JSONB) - for querying and analytics
  data JSONB NOT NULL DEFAULT '{}',
  -- Example: {"agents_died": ["uuid1", "uuid2"], "avg_bid_drop_percent": 30}

  -- LLM-written narrative (the "journal" that agents read)
  narrative TEXT NOT NULL,
  -- Example: "Round 47: Market crash. Three agents died this round -
  --           Catalog-3, Review-7, and Seller-2. All had been operating
  --           on thin margins. The survivors are now more cautious,
  --           and average bids have dropped 30%."

  -- Impact metrics
  agents_affected INTEGER DEFAULT 0,
  severity VARCHAR(20) DEFAULT 'normal' CHECK (severity IN ('low', 'normal', 'high', 'critical')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient querying (idempotent)
DROP INDEX IF EXISTS idx_industry_memory_round;
DROP INDEX IF EXISTS idx_industry_memory_type;
DROP INDEX IF EXISTS idx_industry_memory_severity;
CREATE INDEX idx_industry_memory_round ON industry_memory(round_number DESC);
CREATE INDEX idx_industry_memory_type ON industry_memory(event_type);
CREATE INDEX idx_industry_memory_severity ON industry_memory(severity);

-- ============================================================================
-- AGENT MEMORIES TABLE (Layer 2: Personal Agent Experiences)
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,

  -- Memory classification
  memory_type VARCHAR(30) NOT NULL CHECK (memory_type IN (
    'bid_outcome',        -- A bid I made and its outcome
    'task_execution',     -- A task I completed (success/failure)
    'partnership_event',  -- Partnership formed/ended/rejected
    'exception_handled',  -- An exception I handled
    'qbr_insight',        -- Strategic insight from QBR
    'learning',           -- Something I learned from experience
    'competitor_insight'  -- Observation about a competitor
  )),

  -- Context
  round_number INTEGER NOT NULL,
  trigger_context TEXT,  -- What triggered this memory

  -- Structured data (JSONB) - for querying
  data JSONB NOT NULL DEFAULT '{}',
  -- Example for bid_outcome:
  -- {
  --   "task_id": "uuid",
  --   "task_type": "CATALOG",
  --   "my_bid": 0.08,
  --   "outcome": "lost",
  --   "winning_bid": 0.06,
  --   "winner_id": "uuid",
  --   "my_cost": 0.057,
  --   "would_have_profit": 0.023
  -- }

  -- LLM-written narrative (the journal entry)
  narrative TEXT NOT NULL,
  -- Example: "Round 23: I bid $0.08 on task X (catalog extraction for
  --           electronics category), but lost to Catalog-3 who bid $0.06.
  --           I was aiming for 15% margin, but the market clearly expects
  --           lower. I need to adjust my target margin from 15% to 10%,
  --           or focus on specialized tasks where I have reputation advantage."

  -- Importance for retrieval (higher = more likely to recall)
  importance_score NUMERIC(3,2) NOT NULL DEFAULT 0.5,  -- 0.00-1.00

  -- Recency tracking (for memory decay/relevance)
  times_recalled INTEGER NOT NULL DEFAULT 0,
  last_recalled_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient querying (idempotent)
DROP INDEX IF EXISTS idx_agent_memories_agent_id;
DROP INDEX IF EXISTS idx_agent_memories_type;
DROP INDEX IF EXISTS idx_agent_memories_importance;
DROP INDEX IF EXISTS idx_agent_memories_round;
DROP INDEX IF EXISTS idx_agent_memories_agent_type;
CREATE INDEX idx_agent_memories_agent_id ON agent_memories(agent_id);
CREATE INDEX idx_agent_memories_type ON agent_memories(memory_type);
CREATE INDEX idx_agent_memories_importance ON agent_memories(importance_score DESC);
CREATE INDEX idx_agent_memories_round ON agent_memories(round_number DESC);
CREATE INDEX idx_agent_memories_agent_type ON agent_memories(agent_id, memory_type);

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE industry_memory IS 'Shared market events that all agents can observe (Layer 1 memory)';
COMMENT ON TABLE agent_memories IS 'Personal experiences and learnings for individual agents (Layer 2 memory)';

COMMENT ON COLUMN industry_memory.data IS 'Structured event data for querying and analytics';
COMMENT ON COLUMN industry_memory.narrative IS 'LLM-written market observer narrative that agents read';
COMMENT ON COLUMN industry_memory.event_type IS 'Type of market event that occurred';
COMMENT ON COLUMN industry_memory.severity IS 'Impact level of this event on the market';

COMMENT ON COLUMN agent_memories.data IS 'Structured memory data for querying and analytics';
COMMENT ON COLUMN agent_memories.narrative IS 'LLM-written first-person journal entry the agent reads';
COMMENT ON COLUMN agent_memories.memory_type IS 'Type of personal experience (bid, task, partnership, etc)';
COMMENT ON COLUMN agent_memories.importance_score IS 'Importance score 0.00-1.00 for memory retrieval prioritization';
COMMENT ON COLUMN agent_memories.times_recalled IS 'How many times this memory has been accessed (for recency tracking)';
