-- ============================================================================
-- Migration: Add round_started and system_error event types
-- Date: 2026-02-11
-- Purpose: Admin round execution history and error logging
-- ============================================================================

-- Drop the existing CHECK constraint(s) and recreate with new types
-- Note: constraint may be named economy_events_type_check or economy_events_event_type_check
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
    -- NEW: Admin observability events
    'round_started', 'system_error'
  )
);
