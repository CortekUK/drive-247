-- Add custom domain support for tenants
-- Allows tenants to use their own domain (e.g., revtekrentals.com) instead of {slug}.drive-247.com

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_booking_domain TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_portal_domain TEXT;

-- Add unique constraints idempotently
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_custom_booking_domain_key'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_custom_booking_domain_key UNIQUE (custom_booking_domain);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_custom_portal_domain_key'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_custom_portal_domain_key UNIQUE (custom_portal_domain);
  END IF;
END $$;

COMMENT ON COLUMN tenants.custom_booking_domain IS 'Custom domain for booking site (e.g., revtekrentals.com). Must also be added in Vercel and DNS pointed to Vercel.';
COMMENT ON COLUMN tenants.custom_portal_domain IS 'Custom domain for admin portal (e.g., portal.revtekrentals.com). Must also be added in Vercel and DNS pointed to Vercel.';

-- Index for fast lookup by custom domain (middleware queries on every request)
CREATE INDEX IF NOT EXISTS idx_tenants_custom_booking_domain ON tenants (custom_booking_domain) WHERE custom_booking_domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_custom_portal_domain ON tenants (custom_portal_domain) WHERE custom_portal_domain IS NOT NULL;
