-- Add maintenance banner support (global via admin_settings + per-tenant via tenants)

-- Global maintenance banner on admin_settings
ALTER TABLE admin_settings
ADD COLUMN IF NOT EXISTS maintenance_banner_enabled BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS maintenance_banner_message TEXT NOT NULL DEFAULT 'We are currently performing scheduled maintenance. Some features may be temporarily unavailable.',
ADD COLUMN IF NOT EXISTS maintenance_banner_type TEXT NOT NULL DEFAULT 'warning'
  CHECK (maintenance_banner_type IN ('info', 'warning', 'critical'));

-- Per-tenant maintenance banner on tenants
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS maintenance_banner_enabled BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS maintenance_banner_message TEXT NOT NULL DEFAULT 'We are currently performing scheduled maintenance. Some features may be temporarily unavailable.';
