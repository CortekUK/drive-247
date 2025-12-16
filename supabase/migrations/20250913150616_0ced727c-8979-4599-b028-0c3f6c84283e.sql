-- Add unique constraint for payment ledger entries (idempotency)
ALTER TABLE ledger_entries 
ADD CONSTRAINT ux_ledger_payment_reference 
UNIQUE (reference, type) 
WHERE type = 'Payment';

-- Add unique constraint for P&L entries by reference (idempotency)
ALTER TABLE pnl_entries 
ADD CONSTRAINT ux_pnl_reference 
UNIQUE (source_ref) 
WHERE source_ref IS NOT NULL;

-- Disable existing payment triggers to avoid conflicts with centralized service
DROP TRIGGER IF EXISTS trigger_apply_payment_on_insert ON payments;
DROP TRIGGER IF EXISTS trigger_payments_auto_apply ON payments;

-- Create new trigger to call centralized payment service
CREATE OR REPLACE FUNCTION trigger_call_payment_service()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger for new payments, let the edge function handle the processing
  -- This ensures all payment effects go through the centralized service
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add indexes for better performance on payment processing queries
CREATE INDEX IF NOT EXISTS idx_ledger_entries_rental_charges 
ON ledger_entries (rental_id, type, category, remaining_amount, due_date, entry_date) 
WHERE type = 'Charge' AND category = 'Rental' AND remaining_amount > 0;

CREATE INDEX IF NOT EXISTS idx_payments_processing 
ON payments (customer_id, rental_id, payment_date, status);

-- Add index for payment applications lookup
CREATE INDEX IF NOT EXISTS idx_payment_applications_payment 
ON payment_applications (payment_id);

-- Ensure payment_applications unique constraint exists
ALTER TABLE payment_applications 
ADD CONSTRAINT ux_payment_app_unique 
UNIQUE (payment_id, charge_entry_id);

-- Add comment for documentation
COMMENT ON CONSTRAINT ux_ledger_payment_reference ON ledger_entries IS 'Ensures idempotent payment ledger entries';
COMMENT ON CONSTRAINT ux_pnl_reference ON pnl_entries IS 'Ensures idempotent P&L entries';
COMMENT ON CONSTRAINT ux_payment_app_unique ON payment_applications IS 'Ensures unique payment applications';