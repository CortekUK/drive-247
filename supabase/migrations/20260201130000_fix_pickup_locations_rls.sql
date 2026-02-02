-- Fix RLS policies for pickup_locations table
-- The FOR ALL policy may not work correctly for INSERT operations

-- Drop the existing combined policy
DROP POLICY IF EXISTS "Tenant users manage own locations" ON public.pickup_locations;

-- Create separate policies for each operation

-- SELECT: Tenant users can read their own locations
CREATE POLICY "Tenant users can select own locations" ON public.pickup_locations
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM app_users WHERE auth_user_id = auth.uid()
    )
  );

-- INSERT: Tenant users can insert locations for their tenant
CREATE POLICY "Tenant users can insert own locations" ON public.pickup_locations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM app_users WHERE auth_user_id = auth.uid()
    )
  );

-- UPDATE: Tenant users can update their own locations
CREATE POLICY "Tenant users can update own locations" ON public.pickup_locations
  FOR UPDATE
  TO authenticated
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

-- DELETE: Tenant users can delete their own locations
CREATE POLICY "Tenant users can delete own locations" ON public.pickup_locations
  FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM app_users WHERE auth_user_id = auth.uid()
    )
  );

-- Service role can do everything (needed for edge functions)
DROP POLICY IF EXISTS "Service role can manage pickup_locations" ON public.pickup_locations;
CREATE POLICY "Service role can manage pickup_locations" ON public.pickup_locations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
