-- Add tenant_type column to tenants table
-- This allows distinguishing between production (real customers) and test (internal) tenants

ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS tenant_type TEXT DEFAULT NULL;

-- Add a check constraint to ensure only valid values
ALTER TABLE tenants
ADD CONSTRAINT tenants_tenant_type_check
CHECK (tenant_type IS NULL OR tenant_type IN ('production', 'test'));

-- Add a comment to describe the column
COMMENT ON COLUMN tenants.tenant_type IS 'Type of tenant: production (real customer) or test (internal/testing)';
