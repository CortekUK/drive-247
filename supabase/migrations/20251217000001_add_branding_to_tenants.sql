-- Migration: Add branding columns to tenants table for per-tenant customization
-- Description: Move branding from global org_settings to per-tenant storage

-- Add branding and customization columns to tenants table
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS app_name TEXT DEFAULT 'Drive 917',
ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#223331',
ADD COLUMN IF NOT EXISTS secondary_color TEXT DEFAULT '#223331',
ADD COLUMN IF NOT EXISTS accent_color TEXT DEFAULT '#E9B63E',
ADD COLUMN IF NOT EXISTS light_primary_color TEXT,
ADD COLUMN IF NOT EXISTS light_secondary_color TEXT,
ADD COLUMN IF NOT EXISTS light_accent_color TEXT,
ADD COLUMN IF NOT EXISTS light_background_color TEXT,
ADD COLUMN IF NOT EXISTS dark_primary_color TEXT,
ADD COLUMN IF NOT EXISTS dark_secondary_color TEXT,
ADD COLUMN IF NOT EXISTS dark_accent_color TEXT,
ADD COLUMN IF NOT EXISTS dark_background_color TEXT,
ADD COLUMN IF NOT EXISTS light_header_footer_color TEXT,
ADD COLUMN IF NOT EXISTS dark_header_footer_color TEXT,
ADD COLUMN IF NOT EXISTS logo_url TEXT,
ADD COLUMN IF NOT EXISTS favicon_url TEXT,
ADD COLUMN IF NOT EXISTS meta_title TEXT,
ADD COLUMN IF NOT EXISTS meta_description TEXT,
ADD COLUMN IF NOT EXISTS og_image_url TEXT,
ADD COLUMN IF NOT EXISTS hero_background_url TEXT;

-- Add site settings columns (contact info, business details)
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS business_hours TEXT,
ADD COLUMN IF NOT EXISTS google_maps_url TEXT,
ADD COLUMN IF NOT EXISTS facebook_url TEXT,
ADD COLUMN IF NOT EXISTS instagram_url TEXT,
ADD COLUMN IF NOT EXISTS twitter_url TEXT,
ADD COLUMN IF NOT EXISTS linkedin_url TEXT;

-- Add operational settings
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York',
ADD COLUMN IF NOT EXISTS date_format TEXT DEFAULT 'MM/DD/YYYY',
ADD COLUMN IF NOT EXISTS min_rental_days INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS max_rental_days INTEGER DEFAULT 90,
ADD COLUMN IF NOT EXISTS booking_lead_time_hours INTEGER DEFAULT 24,
ADD COLUMN IF NOT EXISTS require_identity_verification BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS require_insurance_upload BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'automated';

-- Add comments for documentation
COMMENT ON COLUMN tenants.app_name IS 'Custom application name displayed in header and browser title';
COMMENT ON COLUMN tenants.primary_color IS 'Primary brand color in hex format (e.g., #223331)';
COMMENT ON COLUMN tenants.secondary_color IS 'Secondary brand color in hex format';
COMMENT ON COLUMN tenants.accent_color IS 'Accent color for highlights and CTAs';
COMMENT ON COLUMN tenants.logo_url IS 'URL to tenant logo image';
COMMENT ON COLUMN tenants.favicon_url IS 'URL to tenant favicon';
COMMENT ON COLUMN tenants.hero_background_url IS 'URL to hero section background image';
COMMENT ON COLUMN tenants.meta_title IS 'SEO meta title for the tenant site';
COMMENT ON COLUMN tenants.meta_description IS 'SEO meta description for the tenant site';
COMMENT ON COLUMN tenants.payment_mode IS 'Payment mode: automated (charge immediately) or manual (invoice)';

-- Create RLS policy to allow anonymous users to read active tenant info (for branding)
-- This is necessary because customers visiting the booking site are not authenticated
DROP POLICY IF EXISTS "Anyone can read active tenant branding" ON tenants;
CREATE POLICY "Anyone can read active tenant branding"
ON tenants FOR SELECT
TO anon, authenticated
USING (status = 'active');

-- Create index for faster slug lookups
CREATE INDEX IF NOT EXISTS idx_tenants_slug_status ON tenants(slug, status);
