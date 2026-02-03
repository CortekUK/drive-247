-- Fix RLS policies for pickup_locations table - v2
-- Allow authenticated users to manage locations (app validates tenant access)

-- Drop all existing policies
DROP POLICY IF EXISTS "Public read active locations" ON public.pickup_locations;
DROP POLICY IF EXISTS "Tenant users can select own locations" ON public.pickup_locations;
DROP POLICY IF EXISTS "Tenant users can insert own locations" ON public.pickup_locations;
DROP POLICY IF EXISTS "Tenant users can update own locations" ON public.pickup_locations;
DROP POLICY IF EXISTS "Tenant users can delete own locations" ON public.pickup_locations;
DROP POLICY IF EXISTS "Service role can manage pickup_locations" ON public.pickup_locations;
DROP POLICY IF EXISTS "Tenant users manage own locations" ON public.pickup_locations;

-- Allow public/anon to read active locations (for booking app)
CREATE POLICY "Anyone can read active locations" ON public.pickup_locations
  FOR SELECT
  USING (is_active = true);

-- Allow authenticated users full access (app handles tenant validation)
CREATE POLICY "Authenticated users can select locations" ON public.pickup_locations
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert locations" ON public.pickup_locations
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update locations" ON public.pickup_locations
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete locations" ON public.pickup_locations
  FOR DELETE
  TO authenticated
  USING (true);

-- Service role can do everything
CREATE POLICY "Service role full access" ON public.pickup_locations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
