-- Dividend Escrow Model Implementation
--
-- Protects investor dividends by immediately escrowing their share when agent earns profit.
-- Agent cannot access escrowed funds - only investors can claim their pre-calculated share.
--
-- IMPORTANT: If you get errors about tables already existing, run the DROP statements
-- in the "Cleanup" section first.

-- ============================================================================
-- CLEANUP (uncomment if needed to reset)
-- ============================================================================
-- DROP TABLE IF EXISTS dividend_claims CASCADE;
-- DROP TABLE IF EXISTS escrow_deposits CASCADE;
-- DROP TABLE IF EXISTS investor_escrow CASCADE;
-- DROP FUNCTION IF EXISTS increment_investor_escrow(UUID, TEXT, DECIMAL);

-- ============================================================================
-- 1. Per-Investor Escrow Balance (Running Total)
-- ============================================================================

-- Drop and recreate to ensure correct schema
DROP TABLE IF EXISTS investor_escrow CASCADE;

CREATE TABLE investor_escrow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  investor_wallet TEXT NOT NULL,

  -- Running balance: total earned - total claimed = available
  total_earned DECIMAL(20, 6) NOT NULL DEFAULT 0,
  total_claimed DECIMAL(20, 6) NOT NULL DEFAULT 0,
  available_to_claim DECIMAL(20, 6) GENERATED ALWAYS AS (total_earned - total_claimed) STORED,

  -- Timestamps
  last_deposit_at TIMESTAMPTZ,
  last_claim_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Each investor can only have one record per agent
  UNIQUE(agent_id, investor_wallet)
);

-- Add foreign key separately (more resilient to schema variations)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agents') THEN
    ALTER TABLE investor_escrow
      ADD CONSTRAINT fk_investor_escrow_agent
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON TABLE investor_escrow IS 'Per-investor escrow balance for protected dividends. The available_to_claim column is auto-calculated.';

-- ============================================================================
-- 2. Escrow Deposit Audit Trail
-- ============================================================================

DROP TABLE IF EXISTS escrow_deposits CASCADE;

CREATE TABLE escrow_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  task_id UUID,

  -- Profit split details
  gross_profit DECIMAL(20, 6) NOT NULL,
  investor_share_total DECIMAL(20, 6) NOT NULL,
  agent_share DECIMAL(20, 6) NOT NULL,
  investor_share_bps INTEGER NOT NULL,

  -- Holder snapshot
  holder_count INTEGER NOT NULL DEFAULT 0,
  total_token_supply DECIMAL(30, 0),

  -- Transaction tracking
  tx_hash TEXT,
  deposited_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign keys separately
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agents') THEN
    ALTER TABLE escrow_deposits
      ADD CONSTRAINT fk_escrow_deposits_agent
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tasks') THEN
    ALTER TABLE escrow_deposits
      ADD CONSTRAINT fk_escrow_deposits_task
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON TABLE escrow_deposits IS 'Audit trail of all profit distributions to escrow';

-- ============================================================================
-- 3. Dividend Claim History
-- ============================================================================

DROP TABLE IF EXISTS dividend_claims CASCADE;

CREATE TABLE dividend_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  investor_wallet TEXT NOT NULL,

  -- Claim details
  amount DECIMAL(20, 6) NOT NULL,

  -- Transaction tracking
  tx_hash TEXT,
  claimed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key separately
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agents') THEN
    ALTER TABLE dividend_claims
      ADD CONSTRAINT fk_dividend_claims_agent
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON TABLE dividend_claims IS 'History of investor dividend claims';

-- ============================================================================
-- 4. RPC Function: Atomic Increment Investor Escrow
-- ============================================================================

DROP FUNCTION IF EXISTS increment_investor_escrow(UUID, TEXT, DECIMAL);

CREATE FUNCTION increment_investor_escrow(
  p_agent_id UUID,
  p_investor_wallet TEXT,
  p_amount DECIMAL
) RETURNS void AS $$
BEGIN
  INSERT INTO investor_escrow (agent_id, investor_wallet, total_earned, last_deposit_at)
  VALUES (p_agent_id, lower(p_investor_wallet), p_amount, NOW())
  ON CONFLICT (agent_id, investor_wallet)
  DO UPDATE SET
    total_earned = investor_escrow.total_earned + p_amount,
    last_deposit_at = NOW(),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_investor_escrow IS 'Atomically add to an investor escrow balance. Creates record if not exists.';

-- ============================================================================
-- 5. Update Economy Events Constraint
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'economy_events') THEN
    ALTER TABLE economy_events DROP CONSTRAINT IF EXISTS economy_events_type_check;

    ALTER TABLE economy_events ADD CONSTRAINT economy_events_type_check CHECK (
      event_type IN (
        'task_completed', 'investment', 'partnership', 'agent_death',
        'auction_won', 'policy_change', 'dividend_paid', 'token_bought',
        'token_sold', 'reputation_changed',
        'task_assigned', 'task_payment', 'cost_sink_payment', 'x402_payment',
        'escrow_deposit', 'dividend_claimed'
      )
    );
  END IF;
END $$;

-- ============================================================================
-- 6. Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_investor_escrow_agent ON investor_escrow(agent_id);
CREATE INDEX IF NOT EXISTS idx_investor_escrow_wallet ON investor_escrow(investor_wallet);
CREATE INDEX IF NOT EXISTS idx_investor_escrow_available ON investor_escrow(available_to_claim) WHERE available_to_claim > 0;

CREATE INDEX IF NOT EXISTS idx_escrow_deposits_agent ON escrow_deposits(agent_id);
CREATE INDEX IF NOT EXISTS idx_escrow_deposits_task ON escrow_deposits(task_id);
CREATE INDEX IF NOT EXISTS idx_escrow_deposits_deposited_at ON escrow_deposits(deposited_at);

CREATE INDEX IF NOT EXISTS idx_dividend_claims_wallet ON dividend_claims(investor_wallet);
CREATE INDEX IF NOT EXISTS idx_dividend_claims_agent ON dividend_claims(agent_id);
CREATE INDEX IF NOT EXISTS idx_dividend_claims_claimed_at ON dividend_claims(claimed_at);

-- ============================================================================
-- 7. RLS Policies
-- ============================================================================

ALTER TABLE investor_escrow ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividend_claims ENABLE ROW LEVEL SECURITY;

-- Allow all operations for service role (API access)
DROP POLICY IF EXISTS "Service role full access on investor_escrow" ON investor_escrow;
CREATE POLICY "Service role full access on investor_escrow" ON investor_escrow
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on escrow_deposits" ON escrow_deposits;
CREATE POLICY "Service role full access on escrow_deposits" ON escrow_deposits
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on dividend_claims" ON dividend_claims;
CREATE POLICY "Service role full access on dividend_claims" ON dividend_claims
  FOR ALL USING (true) WITH CHECK (true);
