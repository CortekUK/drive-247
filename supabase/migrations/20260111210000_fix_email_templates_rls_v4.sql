-- Fix RLS policy for email_templates to allow super admins to insert for any tenant
-- The previous policy checked if tenant_id matches the user's tenant, OR if user is super_admin
-- But the WITH CHECK condition also needs to consider super_admin for the INSERT operation

-- Drop existing policy
DROP POLICY IF EXISTS "tenant_isolation_email_templates" ON public.email_templates;

-- Ensure RLS is enabled
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

-- Create separate policies for different operations to have more control

-- SELECT: Allow if user's tenant matches OR user is super admin
CREATE POLICY "email_templates_select"
  ON public.email_templates
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    OR public.is_super_admin()
  );

-- INSERT: Allow if user's tenant matches OR user is super admin
-- Super admin can insert for ANY tenant_id
CREATE POLICY "email_templates_insert"
  ON public.email_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    OR public.is_super_admin()
  );

-- UPDATE: Allow if user's tenant matches OR user is super admin
CREATE POLICY "email_templates_update"
  ON public.email_templates
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    OR public.is_super_admin()
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    OR public.is_super_admin()
  );

-- DELETE: Allow if user's tenant matches OR user is super admin
CREATE POLICY "email_templates_delete"
  ON public.email_templates
  FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    OR public.is_super_admin()
  );
