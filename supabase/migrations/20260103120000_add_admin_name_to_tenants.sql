-- Add admin_name column to tenants table
-- This stores the name of the rental company's primary admin contact

ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS admin_name TEXT DEFAULT NULL;

COMMENT ON COLUMN tenants.admin_name IS 'Name of the rental company primary admin/contact person';
