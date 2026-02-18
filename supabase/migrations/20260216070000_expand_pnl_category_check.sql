-- Expand pnl_entries category CHECK constraint to include Insurance and other payment categories
ALTER TABLE pnl_entries DROP CONSTRAINT IF EXISTS chk_pnl_category_valid;
ALTER TABLE pnl_entries ADD CONSTRAINT chk_pnl_category_valid
  CHECK (category = ANY (ARRAY[
    'Initial Fees'::text, 'Rental'::text, 'Acquisition'::text, 'Finance'::text,
    'Service'::text, 'Fines'::text, 'Other'::text, 'Disposal'::text, 'Plates'::text,
    'Insurance'::text, 'Delivery Fee'::text, 'Extras'::text, 'Security Deposit'::text,
    'Extension'::text, 'Excess Mileage'::text, 'Tax'::text, 'Service Fee'::text
  ]));
