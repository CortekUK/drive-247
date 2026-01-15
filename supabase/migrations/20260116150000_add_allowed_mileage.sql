-- Add allowed_mileage column to vehicles table
-- Stores miles per month (e.g., 1500 for "1500 miles/month")
-- NULL means unlimited mileage

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS allowed_mileage integer DEFAULT NULL;

COMMENT ON COLUMN public.vehicles.allowed_mileage IS 'Allowed mileage per month in miles (NULL = unlimited)';
