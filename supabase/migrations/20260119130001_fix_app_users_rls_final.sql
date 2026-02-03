-- Final fix for app_users RLS - simplify the policy to avoid function call issues

-- Drop all existing SELECT policies on app_users
DROP POLICY IF EXISTS "users_read_self" ON "public"."app_users";
DROP POLICY IF EXISTS "super_admin_read_all" ON "public"."app_users";
DROP POLICY IF EXISTS "tenant_admins_read_users" ON "public"."app_users";
DROP POLICY IF EXISTS "app_users_select_policy" ON "public"."app_users";

-- Create a helper function that safely checks if current user is tenant admin
-- This function uses SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION public.is_tenant_admin_for(check_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app_users
    WHERE auth_user_id = auth.uid()
    AND is_active = true
    AND role IN ('head_admin', 'admin')
    AND (tenant_id = check_tenant_id OR is_super_admin = true)
  );
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.is_tenant_admin_for(uuid) TO authenticated;

-- Create ONE simple SELECT policy
CREATE POLICY "app_users_select_policy" ON "public"."app_users"
FOR SELECT
TO authenticated
USING (
  -- Super admins can read all users
  public.is_super_admin()
  OR
  -- User can always read their own record
  auth.uid() = auth_user_id
  OR
  -- Tenant admins can read users in their tenant using the helper function
  public.is_tenant_admin_for(tenant_id)
);

-- Add comment
COMMENT ON POLICY "app_users_select_policy" ON "public"."app_users" IS
'SELECT policy: super admins read all, users read self, tenant admins read tenant users';
