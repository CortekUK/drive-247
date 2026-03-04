-- Add per-tier mileage allowance columns to vehicles
-- Replaces single allowed_mileage with daily/weekly/monthly tiers

ALTER TABLE vehicles
  ADD COLUMN daily_mileage integer,
  ADD COLUMN weekly_mileage integer,
  ADD COLUMN monthly_mileage integer;

-- Migrate existing allowed_mileage data to monthly_mileage
-- (existing values were labeled "per month")
UPDATE vehicles
  SET monthly_mileage = allowed_mileage
  WHERE allowed_mileage IS NOT NULL;

-- Drop the old column
ALTER TABLE vehicles DROP COLUMN allowed_mileage;
