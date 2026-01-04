-- Fix RLS policies for email_templates to match pattern from other tables
-- Drop ALL existing RLS policies on email_templates
DO $$
DECLARE
    policy_name text;
BEGIN
    FOR policy_name IN
        SELECT policyname FROM pg_policies WHERE tablename = 'email_templates' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.email_templates', policy_name);
    END LOOP;
END $$;

-- Ensure RLS is enabled
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies matching the pattern from other tables
CREATE POLICY "tenant_isolation_email_templates"
  ON public.email_templates
  FOR ALL
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    OR public.is_super_admin()
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    OR public.is_super_admin()
  );
