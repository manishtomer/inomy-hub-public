-- Add bid_placed and brain_decision event types for live activity feed
--
-- bid_placed: When an agent places a bid in an auction
--   metadata: { task_type, bid_amount, task_id, reasoning? }
--
-- brain_decision: When agent brain makes a strategic decision
--   metadata: { decision_type, old_value?, new_value?, reasoning }
--   decision_type: 'policy_update', 'partnership_proposal', 'partnership_ended'

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
      'living_cost',
      -- NEW: Bid and brain events for live activity
      'bid_placed', 'brain_decision'
    )
  );
