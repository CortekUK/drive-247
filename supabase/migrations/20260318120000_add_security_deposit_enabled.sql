-- Add security_deposit_enabled toggle to tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS security_deposit_enabled BOOLEAN DEFAULT true;
