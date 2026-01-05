-- Add payment_mode column to rentals table
-- Tracks whether the rental was created with 'auto' or 'manual' payment mode

ALTER TABLE rentals
ADD COLUMN IF NOT EXISTS payment_mode text DEFAULT 'manual';

-- Add check constraint for valid values
ALTER TABLE rentals
ADD CONSTRAINT rentals_payment_mode_check
CHECK (payment_mode IN ('auto', 'manual'));

-- Add comment for documentation
COMMENT ON COLUMN rentals.payment_mode IS 'Payment mode used for this rental: auto (immediate capture) or manual (preauth hold)';

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_rentals_payment_mode ON rentals(payment_mode);
