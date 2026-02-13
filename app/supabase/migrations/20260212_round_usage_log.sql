-- Per-wallet round usage tracking for daily limits
CREATE TABLE round_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  rounds_used INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_round_usage_wallet_time ON round_usage_log(wallet_address, created_at DESC);
