-- Unique partial index to prevent duplicate payment ledger entries
-- Acts as a database-level lock for apply-payment idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_payment_unique
  ON ledger_entries (payment_id)
  WHERE type = 'Payment' AND payment_id IS NOT NULL;
