-- Comprehensive fix for app_users RLS
-- The issue: logged-in users might have a different tenant_id than the tenant they're viewing

-- Drop all existing SELECT policies on app_users
DROP POLICY IF EXISTS "users_read_self" ON "public"."app_users";
DROP POLICY IF EXISTS "super_admin_read_all" ON "public"."app_users";
DROP POLICY IF EXISTS "tenant_admins_read_users" ON "public"."app_users";
DROP POLICY IF EXISTS "app_users_select_policy" ON "public"."app_users";

-- Drop the helper function if it exists
DROP FUNCTION IF EXISTS public.is_tenant_admin_for(uuid);

-- Create a comprehensive SELECT policy
-- This allows:
-- 1. Users to read their own record (always)
-- 2. Super admins to read all records
-- 3. Head admins and admins to read ALL users in their own tenant
CREATE POLICY "app_users_select_policy" ON "public"."app_users"
FOR SELECT
TO authenticated
USING (
  -- Always allow users to read their own record
  auth.uid() = auth_user_id
  OR
  -- Super admins can read all users
  public.is_super_admin()
  OR
  -- For non-super-admin head_admin/admin users:
  -- They can read users that have the same tenant_id as themselves
  (
    -- The row's tenant_id matches the current user's tenant_id
    tenant_id = public.get_user_tenant_id()
    -- AND the current user is a head_admin or admin
    AND public.get_user_role(auth.uid()) IN ('head_admin', 'admin')
  )
);

COMMENT ON POLICY "app_users_select_policy" ON "public"."app_users" IS
'Users read own record, super admins read all, tenant head_admin/admin read their tenant users';
