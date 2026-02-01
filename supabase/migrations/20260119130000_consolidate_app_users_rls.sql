-- Consolidate all SELECT policies on app_users into one comprehensive policy
-- This fixes issues with multiple overlapping policies causing unexpected behavior

-- Drop all existing SELECT policies on app_users
DROP POLICY IF EXISTS "users_read_self" ON "public"."app_users";
DROP POLICY IF EXISTS "super_admin_read_all" ON "public"."app_users";
DROP POLICY IF EXISTS "tenant_admins_read_users" ON "public"."app_users";

-- Create ONE comprehensive SELECT policy that covers all cases
CREATE POLICY "app_users_select_policy" ON "public"."app_users"
FOR SELECT
TO authenticated
USING (
  -- Case 1: Super admins can read all users
  public.is_super_admin()
  OR
  -- Case 2: User can always read their own record
  auth.uid() = auth_user_id
  OR
  -- Case 3: Head admins and admins can read all users in their tenant
  (
    tenant_id IS NOT NULL
    AND tenant_id = public.get_user_tenant_id()
    AND public.get_user_role(auth.uid()) IN ('head_admin', 'admin')
  )
);

-- Add comment
COMMENT ON POLICY "app_users_select_policy" ON "public"."app_users" IS
'Consolidated SELECT policy: super admins read all, users read self, tenant admins read tenant users';
