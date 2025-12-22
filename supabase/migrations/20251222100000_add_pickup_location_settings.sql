-- Migration: Add pickup/return location configuration to tenants
-- This allows tenants to control how customers select pickup/return locations

-- ============================================
-- 1. Add location mode settings to tenants table
-- ============================================
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS pickup_location_mode text DEFAULT 'custom'
    CHECK (pickup_location_mode IN ('fixed', 'custom', 'multiple')),
  ADD COLUMN IF NOT EXISTS return_location_mode text DEFAULT 'custom'
    CHECK (return_location_mode IN ('fixed', 'custom', 'multiple')),
  ADD COLUMN IF NOT EXISTS fixed_pickup_address text,
  ADD COLUMN IF NOT EXISTS fixed_return_address text;

COMMENT ON COLUMN public.tenants.pickup_location_mode IS
  'Location selection mode for pickup: fixed (single address), custom (free-form), or multiple (predefined list)';
COMMENT ON COLUMN public.tenants.return_location_mode IS
  'Location selection mode for return: fixed (single address), custom (free-form), or multiple (predefined list)';
COMMENT ON COLUMN public.tenants.fixed_pickup_address IS
  'Fixed pickup address when pickup_location_mode is "fixed"';
COMMENT ON COLUMN public.tenants.fixed_return_address IS
  'Fixed return address when return_location_mode is "fixed"';

-- ============================================
-- 2. Create pickup_locations table for "multiple" mode
-- ============================================
CREATE TABLE IF NOT EXISTS public.pickup_locations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL,
  is_pickup_enabled boolean DEFAULT true NOT NULL,
  is_return_enabled boolean DEFAULT true NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pickup_locations_name_tenant_unique UNIQUE (tenant_id, name)
);

COMMENT ON TABLE public.pickup_locations IS 'Predefined pickup/return locations for tenants using "multiple" location mode';
COMMENT ON COLUMN public.pickup_locations.name IS 'Display name for the location (e.g., "Downtown Office", "Airport Terminal")';
COMMENT ON COLUMN public.pickup_locations.address IS 'Full address of the location';
COMMENT ON COLUMN public.pickup_locations.is_pickup_enabled IS 'Whether this location can be used for pickups';
COMMENT ON COLUMN public.pickup_locations.is_return_enabled IS 'Whether this location can be used for returns';
COMMENT ON COLUMN public.pickup_locations.is_active IS 'Soft delete flag - inactive locations are hidden from customers';
COMMENT ON COLUMN public.pickup_locations.sort_order IS 'Display order in the location dropdown';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_pickup_locations_tenant_id ON public.pickup_locations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pickup_locations_active ON public.pickup_locations(tenant_id, is_active) WHERE is_active = true;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_pickup_locations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_pickup_locations_updated_at ON public.pickup_locations;
CREATE TRIGGER trigger_pickup_locations_updated_at
  BEFORE UPDATE ON public.pickup_locations
  FOR EACH ROW EXECUTE FUNCTION update_pickup_locations_updated_at();

-- ============================================
-- 3. Enable RLS on pickup_locations
-- ============================================
ALTER TABLE public.pickup_locations ENABLE ROW LEVEL SECURITY;

-- Policy: Public can read active locations (for booking app - no auth required)
DROP POLICY IF EXISTS "Public read active locations" ON public.pickup_locations;
CREATE POLICY "Public read active locations" ON public.pickup_locations
  FOR SELECT
  USING (is_active = true);

-- Policy: Authenticated tenant users can manage their own locations
DROP POLICY IF EXISTS "Tenant users manage own locations" ON public.pickup_locations;
CREATE POLICY "Tenant users manage own locations" ON public.pickup_locations
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM app_users WHERE auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM app_users WHERE auth_user_id = auth.uid()
    )
  );

-- ============================================
-- 4. Add location columns to rentals table
-- ============================================
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS pickup_location text,
  ADD COLUMN IF NOT EXISTS pickup_location_id uuid REFERENCES public.pickup_locations(id),
  ADD COLUMN IF NOT EXISTS return_location text,
  ADD COLUMN IF NOT EXISTS return_location_id uuid REFERENCES public.pickup_locations(id);

COMMENT ON COLUMN public.rentals.pickup_location IS 'Full address string for pickup location';
COMMENT ON COLUMN public.rentals.pickup_location_id IS 'Reference to pickup_locations table when using predefined location';
COMMENT ON COLUMN public.rentals.return_location IS 'Full address string for return location';
COMMENT ON COLUMN public.rentals.return_location_id IS 'Reference to pickup_locations table when using predefined location';

-- Create indexes for reporting
CREATE INDEX IF NOT EXISTS idx_rentals_pickup_location_id ON public.rentals(pickup_location_id) WHERE pickup_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rentals_return_location_id ON public.rentals(return_location_id) WHERE return_location_id IS NOT NULL;
