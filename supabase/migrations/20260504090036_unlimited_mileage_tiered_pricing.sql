-- Replace single per-day price with three flat-per-tier prices on vehicles.
-- On rentals, drop the per-day column (the flat total is the source of truth)
-- and add an audit column recording which tier the booking fell into.

-- ============================================================
-- 1. Vehicles: add three tier columns, backfill from per-day, drop old.
-- ============================================================
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS unlimited_mileage_price_daily NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS unlimited_mileage_price_weekly NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS unlimited_mileage_price_monthly NUMERIC(10,2);

-- Backfill: previous behavior was per-day × days, so weekly = old × 7, monthly = old × 30.
-- This preserves equivalent pricing for already-configured vehicles. Operators
-- can adjust afterwards.
UPDATE public.vehicles
SET
  unlimited_mileage_price_daily = unlimited_mileage_price_per_day,
  unlimited_mileage_price_weekly = ROUND(unlimited_mileage_price_per_day * 7, 2),
  unlimited_mileage_price_monthly = ROUND(unlimited_mileage_price_per_day * 30, 2)
WHERE unlimited_mileage_price_per_day IS NOT NULL;

ALTER TABLE public.vehicles DROP COLUMN IF EXISTS unlimited_mileage_price_per_day;

COMMENT ON COLUMN public.vehicles.unlimited_mileage_price_daily IS
  'Flat upgrade price for daily-tier bookings (<7 days). NULL = upgrade not offered for this tier.';
COMMENT ON COLUMN public.vehicles.unlimited_mileage_price_weekly IS
  'Flat upgrade price for weekly-tier bookings (7-29 days). NULL = upgrade not offered for this tier.';
COMMENT ON COLUMN public.vehicles.unlimited_mileage_price_monthly IS
  'Flat upgrade price for monthly-tier bookings (>=30 days). NULL = upgrade not offered for this tier.';

-- ============================================================
-- 2. Rentals: add tier audit column, backfill, drop per-day.
-- ============================================================
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS unlimited_mileage_tier TEXT
    CHECK (unlimited_mileage_tier IS NULL OR unlimited_mileage_tier IN ('daily','weekly','monthly'));

-- Backfill: derive tier from rental duration.
UPDATE public.rentals
SET unlimited_mileage_tier = CASE
  WHEN GREATEST(1, DATE_PART('day', end_date::timestamp - start_date::timestamp)::int) >= 30 THEN 'monthly'
  WHEN GREATEST(1, DATE_PART('day', end_date::timestamp - start_date::timestamp)::int) >= 7 THEN 'weekly'
  ELSE 'daily'
END
WHERE is_unlimited_mileage = true AND unlimited_mileage_tier IS NULL;

ALTER TABLE public.rentals DROP COLUMN IF EXISTS unlimited_mileage_price_per_day;

COMMENT ON COLUMN public.rentals.unlimited_mileage_tier IS
  'Tier the booking was priced at when the unlimited-mileage upgrade was added (daily/weekly/monthly). Used to charge tier-jump deltas on extension.';
