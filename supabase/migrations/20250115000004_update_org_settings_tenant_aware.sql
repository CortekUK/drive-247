-- Migration: Make org_settings tenant-aware
-- Description: Each tenant has exactly one org_settings row

-- Add tenant_id to org_settings
ALTER TABLE org_settings
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Add email/SMS configuration columns for tenant customization
ALTER TABLE org_settings
  ADD COLUMN IF NOT EXISTS email_from_name TEXT DEFAULT 'Rental Company',
  ADD COLUMN IF NOT EXISTS email_from_address TEXT,
  ADD COLUMN IF NOT EXISTS email_reply_to TEXT,
  ADD COLUMN IF NOT EXISTS sms_sender_name TEXT DEFAULT 'Rental Co';

-- Create unique constraint: one settings row per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_settings_tenant_id_unique ON org_settings(tenant_id);

-- Create index for fast lookup
CREATE INDEX IF NOT EXISTS idx_org_settings_tenant_id ON org_settings(tenant_id);

-- Add helpful comments
COMMENT ON COLUMN org_settings.tenant_id IS 'Each tenant has exactly one org_settings row';
COMMENT ON COLUMN org_settings.email_from_name IS 'Display name for emails (e.g., "ABC Rentals")';
COMMENT ON COLUMN org_settings.email_from_address IS 'FROM email address (optional, defaults to platform email)';
COMMENT ON COLUMN org_settings.email_reply_to IS 'REPLY-TO email address for customer responses';
COMMENT ON COLUMN org_settings.sms_sender_name IS 'Sender name for SMS notifications (11 chars max)';

-- Remove old org_id column if it exists (replaced by tenant_id)
-- ALTER TABLE org_settings DROP COLUMN IF EXISTS org_id;

-- Note: Existing org_settings rows will have tenant_id = NULL
-- Run data migration script to assign to first tenant
