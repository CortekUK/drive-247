-- Add mileage tracking to key handovers and vehicles
-- This allows tracking odometer readings at pickup/return and vehicle's current mileage

-- Add mileage column to rental_key_handovers
ALTER TABLE public.rental_key_handovers
  ADD COLUMN IF NOT EXISTS mileage integer DEFAULT NULL;

COMMENT ON COLUMN public.rental_key_handovers.mileage IS 'Odometer reading at the time of key handover';

-- Add current_mileage column to vehicles (tracks the latest odometer reading)
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS current_mileage integer DEFAULT NULL;

COMMENT ON COLUMN public.vehicles.current_mileage IS 'Current odometer reading of the vehicle (updated at key return)';
