-- Migration to add RLS policy allowing head_admins and admins to view all users in their tenant
-- This fixes the issue where newly created users don't appear in the Manage Users list

-- First, drop the policy if it exists (in case of re-run)
DROP POLICY IF EXISTS "tenant_admins_read_users" ON "public"."app_users";

-- Add policy for head_admins and admins to read all users in their tenant
-- Using SECURITY DEFINER functions to avoid recursive RLS checks
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

-- Also add a comment explaining the policy
COMMENT ON POLICY "tenant_admins_read_users" ON "public"."app_users" IS
'Allows head_admins and admins to view all users within their tenant for user management purposes';
