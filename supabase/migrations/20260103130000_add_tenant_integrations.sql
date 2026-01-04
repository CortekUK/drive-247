-- Add integration settings columns to tenants table
-- These control which third-party integrations are enabled for each tenant

-- Canopy integration (insurance verification)
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS integration_canopy BOOLEAN DEFAULT false;

-- Veriff integration (identity verification)
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS integration_veriff BOOLEAN DEFAULT false;

-- Bonzah integration (insurance)
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS integration_bonzah BOOLEAN DEFAULT false;

-- Add comments
COMMENT ON COLUMN tenants.integration_canopy IS 'Whether Canopy insurance verification is enabled for this tenant';
COMMENT ON COLUMN tenants.integration_veriff IS 'Whether Veriff identity verification is enabled for this tenant';
COMMENT ON COLUMN tenants.integration_bonzah IS 'Whether Bonzah insurance integration is enabled for this tenant';
