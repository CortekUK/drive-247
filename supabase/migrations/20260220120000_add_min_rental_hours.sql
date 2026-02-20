-- Add min_rental_hours column to tenants for sub-day minimum rental durations
-- Default is 1 hour (min_rental_days defaults to 0 in existing rows)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS min_rental_hours integer NOT NULL DEFAULT 1;

-- Reset min_rental_days to 0 for tenants that had the old default of 1 day
-- so the new default becomes 0 days + 1 hour = 1 hour minimum
UPDATE tenants SET min_rental_days = 0 WHERE min_rental_days = 1;

COMMENT ON COLUMN tenants.min_rental_hours IS 'Additional hours on top of min_rental_days. Total minimum = (min_rental_days * 24) + min_rental_hours. Must be 0-23.';
