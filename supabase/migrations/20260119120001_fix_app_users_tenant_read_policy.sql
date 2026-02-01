-- Fix the RLS policy for app_users to use SECURITY DEFINER functions
-- This avoids recursive RLS checks that were preventing the policy from working

-- Drop the existing policy
DROP POLICY IF EXISTS "tenant_admins_read_users" ON "public"."app_users";

-- Recreate the policy using SECURITY DEFINER functions
CREATE POLICY "tenant_admins_read_users" ON "public"."app_users"
FOR SELECT
TO authenticated
USING (
  -- User can read their own record
  auth.uid() = auth_user_id
  OR
  -- User can read other users in the same tenant if they are head_admin or admin
  -- Using get_user_tenant_id() and get_user_role() which are SECURITY DEFINER functions
  (
    tenant_id = public.get_user_tenant_id()
    AND
    public.get_user_role(auth.uid()) IN ('head_admin', 'admin')
  )
  OR
  -- Super admins can read all users
  public.is_super_admin()
);
