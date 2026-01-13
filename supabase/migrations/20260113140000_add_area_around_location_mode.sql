-- Migration: Add "area_around" location mode for pickup/return locations
-- This allows tenants to configure location search within a radius of customer's live location

-- ============================================
-- 1. Update location mode constraint to include 'area_around'
-- ============================================

-- First, find and drop the existing constraints
DO $$
DECLARE
  constraint_name text;
BEGIN
  -- Find pickup_location_mode constraint
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.tenants'::regclass
    AND conname LIKE '%pickup_location_mode%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END IF;

  -- Find return_location_mode constraint
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.tenants'::regclass
    AND conname LIKE '%return_location_mode%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END IF;
END $$;

-- Add new constraints with 'area_around' option
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_pickup_location_mode_check
    CHECK (pickup_location_mode IS NULL OR pickup_location_mode IN ('fixed', 'custom', 'multiple', 'area_around'));

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_return_location_mode_check
    CHECK (return_location_mode IS NULL OR return_location_mode IN ('fixed', 'custom', 'multiple', 'area_around'));

-- ============================================
-- 2. Add radius columns for area_around mode
-- ============================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS pickup_area_radius_km numeric(5,1) DEFAULT 25,
  ADD COLUMN IF NOT EXISTS return_area_radius_km numeric(5,1) DEFAULT 25,
  ADD COLUMN IF NOT EXISTS area_center_lat numeric(10,6),
  ADD COLUMN IF NOT EXISTS area_center_lon numeric(10,6);

COMMENT ON COLUMN public.tenants.pickup_area_radius_km IS 'Maximum pickup distance in km for area_around mode';
COMMENT ON COLUMN public.tenants.return_area_radius_km IS 'Maximum return distance in km for area_around mode';
COMMENT ON COLUMN public.tenants.area_center_lat IS 'Optional: Fixed center point latitude (if not using live location)';
COMMENT ON COLUMN public.tenants.area_center_lon IS 'Optional: Fixed center point longitude (if not using live location)';
