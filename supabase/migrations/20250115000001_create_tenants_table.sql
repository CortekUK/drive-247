-- Migration: Create tenants table for multi-tenant SAAS architecture
-- Description: Central table to manage all rental companies on the platform

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,              -- Subdomain slug (e.g., 'rental-a', 'drive917')
  company_name TEXT NOT NULL,             -- Display name (e.g., 'Rental Company A')
  status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'suspended', 'trial'
  master_password_hash TEXT,              -- Bcrypt hash of master password for super admin access
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Contact Information
  contact_email TEXT,
  contact_phone TEXT,

  -- Subscription Management (for future billing)
  subscription_plan TEXT DEFAULT 'basic', -- 'basic', 'pro', 'enterprise'
  trial_ends_at TIMESTAMPTZ,              -- Trial expiration date

  -- Constraints
  CONSTRAINT valid_status CHECK (status IN ('active', 'suspended', 'trial')),
  CONSTRAINT valid_slug CHECK (slug ~ '^[a-z0-9-]+$'), -- Lowercase alphanumeric + hyphens only
  CONSTRAINT slug_length CHECK (char_length(slug) >= 3 AND char_length(slug) <= 50)
);

-- Index for fast subdomain resolution
CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_status ON tenants(status);

-- Enable RLS on tenants table
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- Add helpful comment
COMMENT ON TABLE tenants IS 'Stores all rental companies (tenants) on the SAAS platform';
COMMENT ON COLUMN tenants.slug IS 'URL-safe subdomain identifier (e.g., rental-a.yourdomain.com)';
COMMENT ON COLUMN tenants.master_password_hash IS 'Bcrypt hash for super admin master password access';
COMMENT ON COLUMN tenants.status IS 'Tenant status: active (normal), suspended (blocked), trial (evaluation period)';
