-- Unlimited Mileage Upgrade — opt-in paid add-on layered on top of the
-- existing tier-based mileage system. Customer or operator can buy unlimited
-- mileage for a rental at a per-day rate; once enabled, the rental skips all
-- excess-mileage calculations.

-- 1. Vehicle settings: operator-managed defaults.
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS unlimited_mileage_available BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unlimited_mileage_price_per_day NUMERIC(10,2);

COMMENT ON COLUMN public.vehicles.unlimited_mileage_available IS
  'When true, the booking checkout offers a paid unlimited-mileage upgrade for this vehicle.';
COMMENT ON COLUMN public.vehicles.unlimited_mileage_price_per_day IS
  'Per-day upcharge for unlimited mileage. Required when unlimited_mileage_available = true.';

-- 2. Rental snapshot: locks the deal at booking time so later vehicle changes
-- don't alter what the customer agreed to.
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS is_unlimited_mileage BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unlimited_mileage_price_per_day NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS unlimited_mileage_total NUMERIC(10,2);

COMMENT ON COLUMN public.rentals.is_unlimited_mileage IS
  'When true, this rental was booked with the unlimited-mileage upgrade. Excess-mileage calc is skipped.';
COMMENT ON COLUMN public.rentals.unlimited_mileage_price_per_day IS
  'Per-day rate at booking time. Locked — vehicle-side changes do not affect this.';
COMMENT ON COLUMN public.rentals.unlimited_mileage_total IS
  'Total upgrade charge: price_per_day × rental_days at booking. Bumped on extension by extra_days × price_per_day.';

-- 3. Ledger and P&L category enums: add 'Unlimited Mileage'.
ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_category_check;
ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_category_check
  CHECK (category = ANY (ARRAY[
    'Rental'::text, 'InitialFee'::text, 'Initial Fees'::text, 'Fine'::text, 'Fines'::text,
    'Adjustment'::text, 'Tax'::text, 'Service Fee'::text, 'Security Deposit'::text,
    'Extension'::text, 'Extension Rental'::text, 'Extension Tax'::text, 'Extension Service Fee'::text,
    'Extension Insurance'::text, 'Excess Mileage'::text, 'Unlimited Mileage'::text,
    'Insurance'::text, 'Delivery Fee'::text, 'Collection Fee'::text, 'Extras'::text,
    'Supercharger'::text, 'Other'::text
  ]));

ALTER TABLE public.pnl_entries DROP CONSTRAINT IF EXISTS chk_pnl_category_valid;
ALTER TABLE public.pnl_entries ADD CONSTRAINT chk_pnl_category_valid
  CHECK (category = ANY (ARRAY[
    'Initial Fees'::text, 'Rental'::text, 'Acquisition'::text, 'Finance'::text,
    'Service'::text, 'Fines'::text, 'Other'::text, 'Disposal'::text, 'Plates'::text,
    'Insurance'::text, 'Delivery Fee'::text, 'Extras'::text, 'Security Deposit'::text,
    'Extension'::text, 'Excess Mileage'::text, 'Unlimited Mileage'::text,
    'Tax'::text, 'Service Fee'::text
  ]));
