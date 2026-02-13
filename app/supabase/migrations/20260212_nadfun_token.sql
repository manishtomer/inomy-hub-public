-- nad.fun token integration: store pool address and deployment tx hash
ALTER TABLE agents ADD COLUMN IF NOT EXISTS nadfun_pool_address VARCHAR(42);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS nadfun_tx_hash VARCHAR(66);
