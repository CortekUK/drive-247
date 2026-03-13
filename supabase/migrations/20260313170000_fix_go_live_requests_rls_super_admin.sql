-- Fix: super admins have tenant_id = NULL in app_users, so get_user_tenant_id() returns NULL.
-- Add OR is_super_admin() to INSERT and SELECT policies.

DROP POLICY IF EXISTS "Tenants can view own go-live requests" ON go_live_requests;
DROP POLICY IF EXISTS "Tenants can create go-live requests" ON go_live_requests;
DROP POLICY IF EXISTS "Super admins can view all go-live requests" ON go_live_requests;
DROP POLICY IF EXISTS "Super admins can update go-live requests" ON go_live_requests;

-- Combined SELECT: own tenant OR super admin
CREATE POLICY "Users can view go-live requests"
  ON go_live_requests
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

-- Combined INSERT: own tenant OR super admin
CREATE POLICY "Users can create go-live requests"
  ON go_live_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

-- UPDATE: super admins only
CREATE POLICY "Super admins can update go-live requests"
  ON go_live_requests
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());
