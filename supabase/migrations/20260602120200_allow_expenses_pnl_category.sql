-- The vehicle-expense P&L trigger maps non-Service expense categories to the
-- 'Expenses' P&L bucket, but chk_pnl_category_valid never allowed that value —
-- so those cost entries failed to insert. Add 'Expenses' to the allowed set.
ALTER TABLE public.pnl_entries DROP CONSTRAINT IF EXISTS chk_pnl_category_valid;
ALTER TABLE public.pnl_entries ADD CONSTRAINT chk_pnl_category_valid CHECK (
  category = ANY (ARRAY[
    'Initial Fees', 'Rental', 'Acquisition', 'Finance', 'Service', 'Fines',
    'Other', 'Disposal', 'Plates', 'Insurance', 'Delivery Fee', 'Collection Fee',
    'Extras', 'Security Deposit', 'Extension', 'Extension Rental', 'Extension Tax',
    'Extension Service Fee', 'Extension Insurance', 'Excess Mileage',
    'Unlimited Mileage', 'Tax', 'Service Fee', 'Expenses'
  ]::text[])
);
