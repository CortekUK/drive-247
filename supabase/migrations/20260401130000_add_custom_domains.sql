-- Add custom domain support for tenants
-- Allows tenants to use their own domain (e.g., revtekrentals.com) instead of {slug}.drive-247.com

ALTER TABLE tenants ADD COLUMN custom_booking_domain TEXT UNIQUE;
ALTER TABLE tenants ADD COLUMN custom_portal_domain TEXT UNIQUE;

COMMENT ON COLUMN tenants.custom_booking_domain IS 'Custom domain for booking site (e.g., revtekrentals.com). Must also be added in Vercel and DNS pointed to Vercel.';
COMMENT ON COLUMN tenants.custom_portal_domain IS 'Custom domain for admin portal (e.g., portal.revtekrentals.com). Must also be added in Vercel and DNS pointed to Vercel.';

-- Index for fast lookup by custom domain (middleware queries on every request)
CREATE INDEX idx_tenants_custom_booking_domain ON tenants (custom_booking_domain) WHERE custom_booking_domain IS NOT NULL;
CREATE INDEX idx_tenants_custom_portal_domain ON tenants (custom_portal_domain) WHERE custom_portal_domain IS NOT NULL;
