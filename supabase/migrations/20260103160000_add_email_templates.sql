-- Create email_templates table for customizable customer-facing emails
CREATE TABLE IF NOT EXISTS public.email_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_key text NOT NULL,
  template_name text NOT NULL,
  subject text NOT NULL,
  template_content text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, template_key)
);

-- Add comment
COMMENT ON TABLE public.email_templates IS 'Customizable email templates per tenant for customer-facing communications';

-- Enable RLS
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies
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

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_email_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER email_templates_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_email_templates_updated_at();
