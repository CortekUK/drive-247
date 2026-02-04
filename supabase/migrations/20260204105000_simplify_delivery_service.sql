-- Migration: Simplify delivery & pickup service
-- Change from single-select mode to multi-select options
-- Add delivery fees to pickup_locations and area_around

-- ============================================
-- 1. Add delivery fee to pickup_locations table
-- ============================================
ALTER TABLE public.pickup_locations
  ADD COLUMN IF NOT EXISTS delivery_fee numeric(10,2) NOT NULL DEFAULT 0.00;

COMMENT ON COLUMN public.pickup_locations.delivery_fee IS 'Fee charged to deliver/collect at this location';

-- Constraint to ensure fee is non-negative
ALTER TABLE public.pickup_locations
  ADD CONSTRAINT pickup_locations_delivery_fee_positive CHECK (delivery_fee >= 0);

-- ============================================
-- 2. Add new columns to tenants table for simplified flow
-- ============================================
ALTER TABLE public.tenants
  -- Boolean flags for which options are enabled (multi-select)
  ADD COLUMN IF NOT EXISTS fixed_address_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS multiple_locations_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS area_around_enabled boolean DEFAULT false,
  -- Flat fee for area_around delivery
  ADD COLUMN IF NOT EXISTS area_delivery_fee numeric(10,2) DEFAULT 0.00;

COMMENT ON COLUMN public.tenants.fixed_address_enabled IS 'Enable fixed address option (FREE - customer picks up/returns themselves)';
COMMENT ON COLUMN public.tenants.multiple_locations_enabled IS 'Enable multiple predefined locations with per-location fees';
COMMENT ON COLUMN public.tenants.area_around_enabled IS 'Enable area around delivery with flat fee';
COMMENT ON COLUMN public.tenants.area_delivery_fee IS 'Flat fee for delivery within the area radius';

-- Constraint to ensure fee is non-negative
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_area_delivery_fee_positive CHECK (area_delivery_fee >= 0);

-- ============================================
-- 3. Migrate existing data
-- ============================================
-- Set fixed_address_enabled based on current mode
UPDATE public.tenants
SET fixed_address_enabled = (pickup_location_mode = 'fixed' OR return_location_mode = 'fixed')
WHERE pickup_location_mode IS NOT NULL OR return_location_mode IS NOT NULL;

-- Set multiple_locations_enabled based on current mode
UPDATE public.tenants
SET multiple_locations_enabled = (pickup_location_mode = 'multiple' OR return_location_mode = 'multiple')
WHERE pickup_location_mode IS NOT NULL OR return_location_mode IS NOT NULL;

-- Set area_around_enabled based on current mode
UPDATE public.tenants
SET area_around_enabled = (pickup_location_mode = 'area_around' OR return_location_mode = 'area_around')
WHERE pickup_location_mode IS NOT NULL OR return_location_mode IS NOT NULL;

-- ============================================
-- 4. Add fields to rentals for tracking delivery choice
-- ============================================
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS delivery_option text, -- 'fixed' | 'location' | 'area'
  ADD COLUMN IF NOT EXISTS pickup_location_id uuid REFERENCES public.pickup_locations(id),
  ADD COLUMN IF NOT EXISTS return_location_id uuid REFERENCES public.pickup_locations(id);

COMMENT ON COLUMN public.rentals.delivery_option IS 'Which delivery option was selected: fixed (free), location (predefined), area (radius)';
COMMENT ON COLUMN public.rentals.pickup_location_id IS 'Selected pickup location (for multiple locations option)';
COMMENT ON COLUMN public.rentals.return_location_id IS 'Selected return location (for multiple locations option)';

-- Create index for reporting
CREATE INDEX IF NOT EXISTS idx_rentals_pickup_location_id ON public.rentals(pickup_location_id) WHERE pickup_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rentals_return_location_id ON public.rentals(return_location_id) WHERE return_location_id IS NOT NULL;
