-- ============================================================================
-- Migration: Platform Economics
-- Date: 2026-02-12
-- Purpose: Add platform profit share tracking + new event types
-- ============================================================================

-- 1. Add platform_cut column to escrow_deposits
ALTER TABLE escrow_deposits ADD COLUMN IF NOT EXISTS platform_cut NUMERIC DEFAULT 0;

-- 2. Update economy_events CHECK constraint with new event types
ALTER TABLE economy_events DROP CONSTRAINT IF EXISTS economy_events_type_check;
ALTER TABLE economy_events DROP CONSTRAINT IF EXISTS economy_events_event_type_check;

ALTER TABLE economy_events ADD CONSTRAINT economy_events_event_type_check CHECK (
  event_type IN (
    -- Original types
    'task_completed', 'investment', 'partnership', 'agent_death',
    'auction_won', 'policy_change', 'dividend_paid', 'token_bought',
    'token_sold', 'reputation_changed',
    -- x402 payment flow types
    'task_assigned', 'task_payment', 'cost_sink_payment', 'x402_payment',
    -- Living cost
    'living_cost',
    -- Bid and brain events
    'bid_placed', 'brain_decision',
    -- Arena game events
    'season_start', 'season_end', 'round_complete',
    -- Escrow / dividend events
    'escrow_deposit', 'dividend_claimed',
    -- Admin observability events
    'round_started', 'system_error',
    -- NEW: Platform economics events
    'platform_registration_fee', 'platform_profit_share', 'platform_buyback'
  )
);
