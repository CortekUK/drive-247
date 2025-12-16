-- Add 'Plates' to the list of valid P&L categories
-- This is needed because the plates trigger creates P&L entries with category 'Plates'

ALTER TABLE pnl_entries DROP CONSTRAINT chk_pnl_category_valid;

ALTER TABLE pnl_entries ADD CONSTRAINT chk_pnl_category_valid
CHECK (category = ANY (ARRAY[
  'Initial Fees'::text,
  'Rental'::text,
  'Acquisition'::text,
  'Finance'::text,
  'Service'::text,
  'Fines'::text,
  'Other'::text,
  'Disposal'::text,
  'Plates'::text
]));
