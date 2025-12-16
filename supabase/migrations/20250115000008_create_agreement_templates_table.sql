-- Migration: Create agreement_templates table for tenant-specific contracts
-- Description: Store customizable rental agreement templates per tenant

CREATE TABLE IF NOT EXISTS agreement_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  template_content TEXT NOT NULL,  -- Plain text with {{placeholders}}
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT unique_active_template_per_tenant UNIQUE (tenant_id, is_active) WHERE (is_active = true)
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_agreement_templates_tenant_id ON agreement_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agreement_templates_active ON agreement_templates(tenant_id, is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE agreement_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can read templates for their tenant
CREATE POLICY "tenant_isolation_agreement_templates_read" ON agreement_templates
FOR SELECT
USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- Only super admins can manage templates (via master password)
CREATE POLICY "super_admin_manage_agreement_templates" ON agreement_templates
FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Add helpful comments
COMMENT ON TABLE agreement_templates IS 'Customizable rental agreement templates per tenant for DocuSign integration';
COMMENT ON COLUMN agreement_templates.template_content IS 'Plain text with {{placeholders}} like {{companyName}}, {{customerName}}, {{vehicleReg}}, etc.';
COMMENT ON COLUMN agreement_templates.is_active IS 'Only one active template allowed per tenant';

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_agreement_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_agreement_templates_updated_at
  BEFORE UPDATE ON agreement_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_agreement_templates_updated_at();

-- Insert default template placeholder (will be populated during data migration)
-- This is just a sample structure - actual content will be added per tenant
COMMENT ON TABLE agreement_templates IS 'Default template variables: {{companyName}}, {{companyAddress}}, {{customerName}}, {{customerEmail}}, {{customerPhone}}, {{vehicleMake}}, {{vehicleModel}}, {{vehicleReg}}, {{rentalStart}}, {{rentalEnd}}, {{monthlyRate}}, {{totalAmount}}, {{deposit}}, {{pickupLocation}}, {{returnLocation}}, {{termsAndConditions}}';
