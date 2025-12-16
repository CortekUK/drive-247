-- Create partial unique index for payment ledger entries (idempotency)
CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_payment_reference 
ON ledger_entries (reference, type) 
WHERE type = 'Payment' AND reference IS NOT NULL;

-- Create unique index for P&L entries by source_ref (idempotency)
CREATE UNIQUE INDEX IF NOT EXISTS ux_pnl_source_reference 
ON pnl_entries (source_ref) 
WHERE source_ref IS NOT NULL;

-- Disable existing payment triggers to avoid conflicts with centralized service
DROP TRIGGER IF EXISTS trigger_apply_payment_on_insert ON payments;
DROP TRIGGER IF EXISTS trigger_payments_auto_apply ON payments;

-- Ensure payment_applications unique constraint exists (if not already)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'ux_payment_app_unique' 
    AND table_name = 'payment_applications'
  ) THEN
    ALTER TABLE payment_applications 
    ADD CONSTRAINT ux_payment_app_unique 
    UNIQUE (payment_id, charge_entry_id);
  END IF;
END $$;

-- Add indexes for better performance on payment processing queries
CREATE INDEX IF NOT EXISTS idx_ledger_entries_rental_charges 
ON ledger_entries (rental_id, type, category, remaining_amount, due_date, entry_date) 
WHERE type = 'Charge' AND category = 'Rental' AND remaining_amount > 0;

CREATE INDEX IF NOT EXISTS idx_payments_processing 
ON payments (customer_id, rental_id, payment_date, status);

CREATE INDEX IF NOT EXISTS idx_payment_applications_payment 
ON payment_applications (payment_id);

-- Add comments for documentation
COMMENT ON INDEX ux_ledger_payment_reference IS 'Ensures idempotent payment ledger entries';
COMMENT ON INDEX ux_pnl_source_reference IS 'Ensures idempotent P&L entries';