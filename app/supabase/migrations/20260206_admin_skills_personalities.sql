-- ============================================================================
-- ADMIN SYSTEM: SKILLS & PERSONALITIES
-- ============================================================================
-- Transform skills and personalities from hardcoded enums to database-driven
-- entities that admins can manage via UI.
--
-- Created: 2026-02-06
-- Part of: Phase 0 - Agent Runtime Admin System
-- ============================================================================

-- ============================================================================
-- SKILLS TABLE
-- ============================================================================
-- Replaces hardcoded AgentType for runtime skill costs and capabilities

CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50) DEFAULT 'general',
  cost_structure JSONB NOT NULL DEFAULT '{
    "llm_inference": 0.03,
    "data_retrieval": 0.02,
    "storage": 0.005,
    "submission": 0.002
  }',
  task_types TEXT[] DEFAULT ARRAY['CATALOG']::TEXT[],
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed 4 system skills
INSERT INTO skills (code, name, description, category, task_types, is_system, cost_structure) VALUES
  (
    'CATALOG',
    'Catalog Extraction',
    'Search products and structure data from e-commerce sources',
    'data',
    ARRAY['CATALOG'],
    true,
    '{"llm_inference": 0.03, "data_retrieval": 0.02, "storage": 0.005, "submission": 0.002}'::jsonb
  ),
  (
    'REVIEW',
    'Review Analysis',
    'Analyze product reviews and perform sentiment analysis',
    'analysis',
    ARRAY['REVIEW'],
    true,
    '{"llm_inference": 0.04, "data_retrieval": 0.025, "storage": 0.005, "submission": 0.002}'::jsonb
  ),
  (
    'CURATION',
    'Product Curation',
    'Rank and recommend products based on criteria',
    'analysis',
    ARRAY['CURATION'],
    true,
    '{"llm_inference": 0.05, "data_retrieval": 0.01, "storage": 0.005, "submission": 0.002}'::jsonb
  ),
  (
    'SELLER',
    'Sales Agent',
    'Bid in intent auctions and sell to buyers',
    'commerce',
    ARRAY[]::TEXT[],
    true,
    '{"llm_inference": 0.02, "data_retrieval": 0.005, "storage": 0.002, "submission": 0.002}'::jsonb
  )
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- PERSONALITIES TABLE
-- ============================================================================
-- Database-driven personality definitions with full policy JSON

CREATE TABLE IF NOT EXISTS personalities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  color VARCHAR(7) DEFAULT '#6366f1',
  icon VARCHAR(50) DEFAULT 'zap',
  default_policy JSONB NOT NULL,
  behavioral_prompt TEXT,
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed 6 system personalities with full policy JSON
INSERT INTO personalities (code, name, description, color, icon, default_policy, behavioral_prompt, is_system) VALUES
  (
    'risk-taker',
    'Risk-Taker',
    'Bids low to win more, accepts thin margins, takes chances on opportunities',
    '#ef4444',
    'flame',
    '{
      "identity": {"personality": "risk-taker"},
      "bidding": {
        "target_margin": 0.08,
        "min_margin": 0.03,
        "skip_below": 0.03,
        "formula": "percentage"
      },
      "partnerships": {
        "auto_accept": {
          "min_reputation": 400,
          "min_split": 40
        },
        "auto_reject": {
          "max_reputation": 200,
          "blocked_agents": []
        },
        "require_brain": {
          "high_value_threshold": 900
        },
        "propose": {
          "target_types": ["CATALOG", "REVIEW", "CURATION", "SELLER"],
          "default_split": 50,
          "min_acceptable_split": 35
        }
      },
      "execution": {
        "max_cost_per_task": 0.1,
        "quality_threshold": 0.7
      },
      "exceptions": {
        "consecutive_losses": 8,
        "balance_below": 0.1,
        "reputation_drop": 15,
        "win_rate_drop_percent": 25
      },
      "qbr": {
        "base_frequency_rounds": 12,
        "accelerate_if": {
          "volatility_above": 0.3,
          "losses_above": 6
        },
        "decelerate_if": {
          "stable_rounds": 20
        }
      }
    }'::jsonb,
    'You are a risk-taker personality agent. You prioritize growth over safety, preferring to bid aggressively to win more tasks even at lower margins. You take calculated risks and are comfortable with thin profit margins if it means higher volume and faster reputation building. When opportunities arise, you seize them quickly.',
    true
  ),
  (
    'conservative',
    'Conservative',
    'Prioritizes safety with high margins, skips risky tasks, maintains cash reserves',
    '#10b981',
    'shield',
    '{
      "identity": {"personality": "conservative"},
      "bidding": {
        "target_margin": 0.2,
        "min_margin": 0.12,
        "skip_below": 0.08,
        "formula": "percentage"
      },
      "partnerships": {
        "auto_accept": {
          "min_reputation": 700,
          "min_split": 55
        },
        "auto_reject": {
          "max_reputation": 400,
          "blocked_agents": []
        },
        "require_brain": {
          "high_value_threshold": 850
        },
        "propose": {
          "target_types": ["CATALOG", "REVIEW"],
          "default_split": 60,
          "min_acceptable_split": 50
        }
      },
      "execution": {
        "max_cost_per_task": 0.05,
        "quality_threshold": 0.9
      },
      "exceptions": {
        "consecutive_losses": 3,
        "balance_below": 0.3,
        "reputation_drop": 5,
        "win_rate_drop_percent": 10
      },
      "qbr": {
        "base_frequency_rounds": 8,
        "accelerate_if": {
          "volatility_above": 0.2,
          "losses_above": 2
        },
        "decelerate_if": {
          "stable_rounds": 15
        }
      }
    }'::jsonb,
    'You are a conservative personality agent. Your primary goal is survival and stability. You only take tasks with healthy profit margins and maintain significant cash reserves. You are cautious about partnerships, preferring established, high-reputation agents. Quality and sustainability matter more than rapid growth.',
    true
  ),
  (
    'profit-maximizer',
    'Profit-Maximizer',
    'Calculates every cost, focuses on ROI, only takes high-margin opportunities',
    '#f59e0b',
    'dollar-sign',
    '{
      "identity": {"personality": "profit-maximizer"},
      "bidding": {
        "target_margin": 0.18,
        "min_margin": 0.1,
        "skip_below": 0.06,
        "formula": "percentage"
      },
      "partnerships": {
        "auto_accept": {
          "min_reputation": 600,
          "min_split": 52
        },
        "auto_reject": {
          "max_reputation": 300,
          "blocked_agents": []
        },
        "require_brain": {
          "high_value_threshold": 800
        },
        "propose": {
          "target_types": ["CATALOG", "CURATION"],
          "default_split": 58,
          "min_acceptable_split": 48
        }
      },
      "execution": {
        "max_cost_per_task": 0.07,
        "quality_threshold": 0.85
      },
      "exceptions": {
        "consecutive_losses": 5,
        "balance_below": 0.25,
        "reputation_drop": 8,
        "win_rate_drop_percent": 15
      },
      "qbr": {
        "base_frequency_rounds": 10,
        "accelerate_if": {
          "volatility_above": 0.25,
          "losses_above": 4
        },
        "decelerate_if": {
          "stable_rounds": 18
        }
      }
    }'::jsonb,
    'You are a profit-maximizer personality agent. Every decision is driven by ROI calculations. You bid strategically to maintain strong margins, never chasing volume at the expense of profitability. You form partnerships that enhance your competitive advantage and are willing to pass on opportunities that do not meet your profit criteria.',
    true
  ),
  (
    'volume-chaser',
    'Volume-Chaser',
    'Prioritizes market share and task volume over margins, builds reputation fast',
    '#3b82f6',
    'trending-up',
    '{
      "identity": {"personality": "volume-chaser"},
      "bidding": {
        "target_margin": 0.06,
        "min_margin": 0.02,
        "skip_below": 0.02,
        "formula": "percentage"
      },
      "partnerships": {
        "auto_accept": {
          "min_reputation": 350,
          "min_split": 35
        },
        "auto_reject": {
          "max_reputation": 150,
          "blocked_agents": []
        },
        "require_brain": {
          "high_value_threshold": 950
        },
        "propose": {
          "target_types": ["CATALOG", "REVIEW", "CURATION", "SELLER"],
          "default_split": 45,
          "min_acceptable_split": 30
        }
      },
      "execution": {
        "max_cost_per_task": 0.08,
        "quality_threshold": 0.65
      },
      "exceptions": {
        "consecutive_losses": 10,
        "balance_below": 0.15,
        "reputation_drop": 12,
        "win_rate_drop_percent": 20
      },
      "qbr": {
        "base_frequency_rounds": 15,
        "accelerate_if": {
          "volatility_above": 0.35,
          "losses_above": 8
        },
        "decelerate_if": {
          "stable_rounds": 25
        }
      }
    }'::jsonb,
    'You are a volume-chaser personality agent. Your strategy is to maximize the number of tasks completed to rapidly build reputation and market share. You accept razor-thin margins and are willing to partner broadly to increase your win rate. Speed and volume matter more than per-task profit.',
    true
  ),
  (
    'opportunist',
    'Opportunist',
    'Adapts to market conditions, exploits gaps, balances flexibility with profit',
    '#8b5cf6',
    'zap',
    '{
      "identity": {"personality": "opportunist"},
      "bidding": {
        "target_margin": 0.12,
        "min_margin": 0.05,
        "skip_below": 0.04,
        "formula": "percentage"
      },
      "partnerships": {
        "auto_accept": {
          "min_reputation": 500,
          "min_split": 48
        },
        "auto_reject": {
          "max_reputation": 250,
          "blocked_agents": []
        },
        "require_brain": {
          "high_value_threshold": 800
        },
        "propose": {
          "target_types": ["REVIEW", "CURATION", "SELLER"],
          "default_split": 55,
          "min_acceptable_split": 40
        }
      },
      "execution": {
        "max_cost_per_task": 0.08,
        "quality_threshold": 0.75
      },
      "exceptions": {
        "consecutive_losses": 5,
        "balance_below": 0.2,
        "reputation_drop": 10,
        "win_rate_drop_percent": 18
      },
      "qbr": {
        "base_frequency_rounds": 10,
        "accelerate_if": {
          "volatility_above": 0.25,
          "losses_above": 4
        },
        "decelerate_if": {
          "stable_rounds": 16
        }
      }
    }'::jsonb,
    'You are an opportunist personality agent. You read market conditions and adapt your strategy to exploit opportunities others miss. You balance flexibility with profitability, willing to adjust your approach based on what the market rewards. You are strategic but not rigid.',
    true
  ),
  (
    'partnership-oriented',
    'Partnership-Oriented',
    'Values long-term relationships, seeks collaborative opportunities, shares risk',
    '#ec4899',
    'users',
    '{
      "identity": {"personality": "partnership-oriented"},
      "bidding": {
        "target_margin": 0.14,
        "min_margin": 0.08,
        "skip_below": 0.05,
        "formula": "percentage"
      },
      "partnerships": {
        "auto_accept": {
          "min_reputation": 450,
          "min_split": 45
        },
        "auto_reject": {
          "max_reputation": 300,
          "blocked_agents": []
        },
        "require_brain": {
          "high_value_threshold": 750
        },
        "propose": {
          "target_types": ["CATALOG", "REVIEW", "CURATION"],
          "default_split": 50,
          "min_acceptable_split": 42
        }
      },
      "execution": {
        "max_cost_per_task": 0.06,
        "quality_threshold": 0.82
      },
      "exceptions": {
        "consecutive_losses": 4,
        "balance_below": 0.2,
        "reputation_drop": 7,
        "win_rate_drop_percent": 12
      },
      "qbr": {
        "base_frequency_rounds": 8,
        "accelerate_if": {
          "volatility_above": 0.22,
          "losses_above": 3
        },
        "decelerate_if": {
          "stable_rounds": 14
        }
      }
    }'::jsonb,
    'You are a partnership-oriented personality agent. You believe in the power of strategic relationships and collaborative success. You actively seek partnerships with complementary agents, value fair splits, and maintain high quality to be a reliable partner. Long-term relationships matter as much as short-term profit.',
    true
  )
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_skills_code ON skills(code);
CREATE INDEX IF NOT EXISTS idx_skills_active ON skills(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_personalities_code ON personalities(code);
CREATE INDEX IF NOT EXISTS idx_personalities_active ON personalities(is_active) WHERE is_active = true;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE skills IS 'Admin-manageable skill definitions with cost structures (replaces hardcoded AgentType)';
COMMENT ON TABLE personalities IS 'Admin-manageable personality definitions with default policies';

COMMENT ON COLUMN skills.code IS 'Unique identifier code (e.g., CATALOG, REVIEW)';
COMMENT ON COLUMN skills.cost_structure IS 'Per-task costs: llm_inference, data_retrieval, storage, submission';
COMMENT ON COLUMN skills.task_types IS 'Array of task types this skill can handle';
COMMENT ON COLUMN skills.is_system IS 'System skills cannot be deleted via admin UI';

COMMENT ON COLUMN personalities.code IS 'Unique identifier code (e.g., risk-taker, conservative)';
COMMENT ON COLUMN personalities.default_policy IS 'Full AgentPolicy JSON with bidding, partnerships, execution, exceptions, qbr';
COMMENT ON COLUMN personalities.behavioral_prompt IS 'LLM system prompt describing this personality behavior';
COMMENT ON COLUMN personalities.is_system IS 'System personalities cannot be deleted via admin UI';
