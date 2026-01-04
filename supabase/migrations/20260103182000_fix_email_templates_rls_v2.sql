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

-- Recreate RLS Policies with correct names
CREATE POLICY "email_templates_select_policy"
  ON public.email_templates FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "email_templates_insert_policy"
  ON public.email_templates FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "email_templates_update_policy"
  ON public.email_templates FOR UPDATE
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "email_templates_delete_policy"
  ON public.email_templates FOR DELETE
  USING (tenant_id = get_user_tenant_id());
