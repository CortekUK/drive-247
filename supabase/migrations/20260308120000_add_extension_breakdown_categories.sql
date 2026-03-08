-- Add extension breakdown categories to ledger_entries check constraint
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_category_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_category_check
  CHECK (category = ANY (ARRAY[
    'Rental'::text, 'InitialFee'::text, 'Initial Fees'::text, 'Fine'::text, 'Fines'::text,
    'Adjustment'::text, 'Tax'::text, 'Service Fee'::text, 'Security Deposit'::text,
    'Extension'::text, 'Extension Rental'::text, 'Extension Tax'::text, 'Extension Service Fee'::text,
    'Excess Mileage'::text, 'Insurance'::text, 'Delivery Fee'::text,
    'Extras'::text, 'Other'::text
  ]));
