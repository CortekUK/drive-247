-- Track deposit holds separately on rentals
-- Holds are placed at key giving, released at key receiving, and auto-refreshed for long rentals

ALTER TABLE rentals ADD COLUMN IF NOT EXISTS deposit_hold_payment_intent_id TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS deposit_hold_status TEXT DEFAULT NULL;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS deposit_hold_amount NUMERIC(10,2);
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS deposit_hold_placed_at TIMESTAMPTZ;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS deposit_hold_expires_at TIMESTAMPTZ;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS deposit_hold_payment_method_id TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS deposit_hold_stripe_customer_id TEXT;

-- Add CHECK constraint for deposit_hold_status idempotently
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rentals_deposit_hold_status_check'
  ) THEN
    ALTER TABLE rentals ADD CONSTRAINT rentals_deposit_hold_status_check
      CHECK (deposit_hold_status IN ('held', 'captured', 'released', 'expired', 'refreshing'));
  END IF;
END $$;
