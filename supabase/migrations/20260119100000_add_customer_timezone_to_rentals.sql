-- Migration: Add customer timezone and pickup/dropoff times to rentals table
-- This enables timezone-aware booking where customers can book in their own timezone
-- while the system validates against the tenant's business hours

-- Add pickup and dropoff time columns to rentals
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS pickup_time time DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dropoff_time time DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS customer_timezone text DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.rentals.pickup_time IS 'Customer selected pickup time (HH:MM format)';
COMMENT ON COLUMN public.rentals.dropoff_time IS 'Customer selected dropoff time (HH:MM format)';
COMMENT ON COLUMN public.rentals.customer_timezone IS 'IANA timezone identifier for the customer''s timezone during booking (e.g., America/New_York)';
