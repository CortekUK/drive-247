-- Add per-rental mileage override fields
-- Allows portal admins to override vehicle mileage settings for a specific rental
ALTER TABLE rentals
  ADD COLUMN IF NOT EXISTS daily_mileage_override integer,
  ADD COLUMN IF NOT EXISTS weekly_mileage_override integer,
  ADD COLUMN IF NOT EXISTS monthly_mileage_override integer,
  ADD COLUMN IF NOT EXISTS excess_mileage_rate_override numeric;

COMMENT ON COLUMN rentals.daily_mileage_override IS 'Admin override: daily mileage allowance for this rental (null = use vehicle default)';
COMMENT ON COLUMN rentals.weekly_mileage_override IS 'Admin override: weekly mileage allowance for this rental (null = use vehicle default)';
COMMENT ON COLUMN rentals.monthly_mileage_override IS 'Admin override: monthly mileage allowance for this rental (null = use vehicle default)';
COMMENT ON COLUMN rentals.excess_mileage_rate_override IS 'Admin override: excess mileage rate for this rental (null = use vehicle default)';
