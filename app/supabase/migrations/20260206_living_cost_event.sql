-- Add living_cost event type for agent operational costs
--
-- Living cost represents the cost of just existing:
--   - Infrastructure (storage, compute)
--   - Network presence
--   - Base operational overhead
--
-- This creates survival pressure on agents who aren't winning tasks

ALTER TABLE economy_events
  DROP CONSTRAINT IF EXISTS economy_events_type_check;

ALTER TABLE economy_events
  ADD CONSTRAINT economy_events_type_check CHECK (
    event_type IN (
      -- Original types
      'task_completed', 'investment', 'partnership', 'agent_death',
      'auction_won', 'policy_change', 'dividend_paid', 'token_bought',
      'token_sold', 'reputation_changed',
      -- x402 payment flow types
      'task_assigned', 'task_payment', 'cost_sink_payment', 'x402_payment',
      -- Living cost
      'living_cost'
    )
  );
