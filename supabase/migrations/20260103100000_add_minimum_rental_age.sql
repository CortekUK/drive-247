-- Add minimum_rental_age column to tenants table
-- This allows each tenant to configure their own minimum age requirement for rentals

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS minimum_rental_age integer DEFAULT 18;

-- Add a check constraint to ensure minimum age is at least 16
ALTER TABLE public.tenants
  ADD CONSTRAINT minimum_rental_age_check CHECK (minimum_rental_age >= 16);

COMMENT ON COLUMN public.tenants.minimum_rental_age IS 'Minimum age requirement for renting vehicles (default: 18, min: 16)';
