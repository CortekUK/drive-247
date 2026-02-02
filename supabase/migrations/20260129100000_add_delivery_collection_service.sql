-- Migration: Add delivery & collection service
-- This allows tenants to offer vehicle delivery and collection at predefined locations with separate fees

-- ============================================
-- 1. Create delivery_locations table
-- ============================================
CREATE TABLE IF NOT EXISTS public.delivery_locations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL,
  delivery_fee numeric(10,2) NOT NULL DEFAULT 0.00,
  collection_fee numeric(10,2) NOT NULL DEFAULT 0.00,
  is_delivery_enabled boolean DEFAULT true NOT NULL,
  is_collection_enabled boolean DEFAULT true NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT delivery_locations_name_tenant_unique UNIQUE (tenant_id, name),
  CONSTRAINT delivery_locations_delivery_fee_positive CHECK (delivery_fee >= 0),
  CONSTRAINT delivery_locations_collection_fee_positive CHECK (collection_fee >= 0)
);

COMMENT ON TABLE public.delivery_locations IS 'Locations where tenants can deliver/collect vehicles for a fee';
COMMENT ON COLUMN public.delivery_locations.name IS 'Display name for the location (e.g., "Heathrow Airport Terminal 5")';
COMMENT ON COLUMN public.delivery_locations.address IS 'Full address of the location';
COMMENT ON COLUMN public.delivery_locations.delivery_fee IS 'Fee charged to deliver a vehicle to this location';
COMMENT ON COLUMN public.delivery_locations.collection_fee IS 'Fee charged to collect a vehicle from this location';
COMMENT ON COLUMN public.delivery_locations.is_delivery_enabled IS 'Whether this location can be used for vehicle delivery';
COMMENT ON COLUMN public.delivery_locations.is_collection_enabled IS 'Whether this location can be used for vehicle collection';
COMMENT ON COLUMN public.delivery_locations.is_active IS 'Soft delete flag - inactive locations are hidden from customers';
COMMENT ON COLUMN public.delivery_locations.sort_order IS 'Display order in the location dropdown';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_delivery_locations_tenant_id ON public.delivery_locations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_delivery_locations_active ON public.delivery_locations(tenant_id, is_active) WHERE is_active = true;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_delivery_locations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_delivery_locations_updated_at ON public.delivery_locations;
CREATE TRIGGER trigger_delivery_locations_updated_at
  BEFORE UPDATE ON public.delivery_locations
  FOR EACH ROW EXECUTE FUNCTION update_delivery_locations_updated_at();

-- ============================================
-- 2. Enable RLS on delivery_locations
-- ============================================
ALTER TABLE public.delivery_locations ENABLE ROW LEVEL SECURITY;

-- Policy: Public can read active locations (for booking app - no auth required)
DROP POLICY IF EXISTS "Public read active delivery locations" ON public.delivery_locations;
CREATE POLICY "Public read active delivery locations" ON public.delivery_locations
  FOR SELECT
  USING (is_active = true);

-- Policy: Authenticated tenant users can manage their own locations
DROP POLICY IF EXISTS "Tenant users manage delivery locations" ON public.delivery_locations;
CREATE POLICY "Tenant users manage delivery locations" ON public.delivery_locations
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
-- 3. Add global settings to tenants table
-- ============================================
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS delivery_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS collection_enabled boolean DEFAULT false;

COMMENT ON COLUMN public.tenants.delivery_enabled IS 'Global toggle: Enable vehicle delivery service';
COMMENT ON COLUMN public.tenants.collection_enabled IS 'Global toggle: Enable vehicle collection service';

-- ============================================
-- 4. Add delivery/collection fields to rentals table
-- ============================================
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS uses_delivery_service boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_location_id uuid REFERENCES public.delivery_locations(id),
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS delivery_fee numeric(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS collection_location_id uuid REFERENCES public.delivery_locations(id),
  ADD COLUMN IF NOT EXISTS collection_address text,
  ADD COLUMN IF NOT EXISTS collection_fee numeric(10,2) DEFAULT 0.00;

COMMENT ON COLUMN public.rentals.uses_delivery_service IS 'Whether this rental uses delivery and/or collection service';
COMMENT ON COLUMN public.rentals.delivery_location_id IS 'Reference to delivery_locations table for delivery';
COMMENT ON COLUMN public.rentals.delivery_address IS 'Full address string for delivery location';
COMMENT ON COLUMN public.rentals.delivery_fee IS 'Fee charged for vehicle delivery';
COMMENT ON COLUMN public.rentals.collection_location_id IS 'Reference to delivery_locations table for collection';
COMMENT ON COLUMN public.rentals.collection_address IS 'Full address string for collection location';
COMMENT ON COLUMN public.rentals.collection_fee IS 'Fee charged for vehicle collection';

-- Create indexes for reporting
CREATE INDEX IF NOT EXISTS idx_rentals_delivery_location_id ON public.rentals(delivery_location_id) WHERE delivery_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rentals_collection_location_id ON public.rentals(collection_location_id) WHERE collection_location_id IS NOT NULL;
