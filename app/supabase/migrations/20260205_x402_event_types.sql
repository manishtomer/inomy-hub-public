-- Add new economy event types for x402 operator-to-agent payment flow
--
-- New event types:
--   task_assigned     - Task auction resolved, winner selected (OPEN -> ASSIGNED)
--   task_payment      - Operator paid agent via x402 for task delivery
--   cost_sink_payment - Agent paid operational cost to cost sink (plain USDC)
--   x402_payment      - Generic x402 payment event

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
      'task_assigned', 'task_payment', 'cost_sink_payment', 'x402_payment'
    )
  );
