-- Migration: Update app_users table for multi-tenant architecture
-- Description: Add tenant_id and super admin flags to support SAAS user hierarchy

-- Add new columns to app_users
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_primary_super_admin BOOLEAN DEFAULT false;

-- Add constraint: Regular users must have tenant_id, super admins must NOT have tenant_id
ALTER TABLE app_users
  ADD CONSTRAINT check_tenant_id
  CHECK (
    (is_super_admin = true AND tenant_id IS NULL) OR
    (is_super_admin = false AND tenant_id IS NOT NULL)
  );

-- Add constraint: Only one primary super admin should exist (enforced at application level, but good to document)
COMMENT ON COLUMN app_users.is_primary_super_admin IS 'Only the original super admin can manage other super admins. Only ONE user should have this flag.';

-- Create index for tenant-based queries
CREATE INDEX IF NOT EXISTS idx_app_users_tenant_id ON app_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_app_users_is_super_admin ON app_users(is_super_admin);

-- Add helpful comments
COMMENT ON COLUMN app_users.tenant_id IS 'NULL for super admins, set for rental company users';
COMMENT ON COLUMN app_users.is_super_admin IS 'Platform super admins who manage rental companies';
COMMENT ON COLUMN app_users.is_primary_super_admin IS 'Can manage other super admins (only one user)';

-- Note: Existing users will have tenant_id = NULL
-- Run migration script separately to assign existing users to first tenant
