-- Fix RLS policies for go_live_requests
-- The INSERT policy needs to allow authenticated users to insert for their tenant
-- The SELECT policy also needs to work for authenticated users

-- Drop existing policies and recreate with proper TO authenticated clauses
DROP POLICY IF EXISTS "Tenants can view own go-live requests" ON go_live_requests;
DROP POLICY IF EXISTS "Tenants can create go-live requests" ON go_live_requests;
DROP POLICY IF EXISTS "Super admins can view all go-live requests" ON go_live_requests;
DROP POLICY IF EXISTS "Super admins can update go-live requests" ON go_live_requests;

-- Tenants can read their own requests
CREATE POLICY "Tenants can view own go-live requests"
  ON go_live_requests
  FOR SELECT
  TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- Tenants can insert their own requests
CREATE POLICY "Tenants can create go-live requests"
  ON go_live_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

-- Super admins can view all requests
CREATE POLICY "Super admins can view all go-live requests"
  ON go_live_requests
  FOR SELECT
  TO authenticated
  USING (is_super_admin());

-- Super admins can update requests (approve/reject)
CREATE POLICY "Super admins can update go-live requests"
  ON go_live_requests
  FOR UPDATE
  TO authenticated
  USING (is_super_admin());
