-- Add test_balance column for separate test/live credit tracking
ALTER TABLE tenant_credit_wallets
  ADD COLUMN IF NOT EXISTS test_balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (test_balance >= 0),
  ADD COLUMN IF NOT EXISTS test_lifetime_purchased NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS test_lifetime_used NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Updated deduct_credits and add_credits functions are in the apply_migration call
-- (functions are CREATE OR REPLACE so they update in place)
