-- Fix RLS policies for email_templates table
-- Drop existing policies first (if any)
DROP POLICY IF EXISTS "Users can view their tenant email templates" ON public.email_templates;
DROP POLICY IF EXISTS "Users can insert their tenant email templates" ON public.email_templates;
DROP POLICY IF EXISTS "Users can update their tenant email templates" ON public.email_templates;
DROP POLICY IF EXISTS "Users can delete their tenant email templates" ON public.email_templates;

-- Ensure RLS is enabled
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies
CREATE POLICY "Users can view their tenant email templates"
  ON public.email_templates FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert their tenant email templates"
  ON public.email_templates FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update their tenant email templates"
  ON public.email_templates FOR UPDATE
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can delete their tenant email templates"
  ON public.email_templates FOR DELETE
  USING (tenant_id = get_user_tenant_id());
