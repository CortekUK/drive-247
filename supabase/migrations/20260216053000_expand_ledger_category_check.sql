-- Expand ledger_entries category CHECK constraint to include Insurance, Delivery Fee, Extras, Fines, Other
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_category_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_category_check
  CHECK (category = ANY (ARRAY[
    'Rental'::text, 'InitialFee'::text, 'Initial Fees'::text, 'Fine'::text, 'Fines'::text,
    'Adjustment'::text, 'Tax'::text, 'Service Fee'::text, 'Security Deposit'::text,
    'Extension'::text, 'Excess Mileage'::text, 'Insurance'::text, 'Delivery Fee'::text,
    'Extras'::text, 'Other'::text
  ]));
