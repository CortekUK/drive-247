-- Migration: Create RLS helper functions for tenant isolation
-- Description: Utility functions used by RLS policies to enforce data isolation

-- Function: Get current user's tenant_id
CREATE OR REPLACE FUNCTION get_user_tenant_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT tenant_id
  FROM app_users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_user_tenant_id() IS 'Returns the tenant_id of the currently authenticated user. Returns NULL for super admins.';

-- Function: Check if current user is a super admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1),
    false
  );
$$;

COMMENT ON FUNCTION is_super_admin() IS 'Returns TRUE if current user is a super admin (can access all tenants).';

-- Function: Check if current user is the primary super admin
CREATE OR REPLACE FUNCTION is_primary_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_primary_super_admin FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1),
    false
  );
$$;

COMMENT ON FUNCTION is_primary_super_admin() IS 'Returns TRUE if current user is the primary super admin (can manage other super admins).';

-- Function: Get current user's effective tenant_id (for master password impersonation)
-- This will be used when we implement master password login with impersonation
CREATE OR REPLACE FUNCTION get_effective_tenant_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  -- For now, just return user's tenant_id
  -- Later, this will check for impersonation context from JWT
  SELECT tenant_id
  FROM app_users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_effective_tenant_id() IS 'Returns the effective tenant_id, accounting for super admin impersonation (future feature).';

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_user_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION is_primary_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION get_effective_tenant_id() TO authenticated;
