-- ============================================
-- ADD BRANDING COLUMNS TO ORG_SETTINGS
-- ============================================
-- This script adds all branding customization columns to the org_settings table
-- Run this via Supabase SQL Editor if the settings edge function is failing
-- ============================================

-- Add basic branding fields
ALTER TABLE org_settings
ADD COLUMN IF NOT EXISTS app_name TEXT DEFAULT 'Drive 917',
ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#C6A256',
ADD COLUMN IF NOT EXISTS secondary_color TEXT DEFAULT '#C6A256',
ADD COLUMN IF NOT EXISTS accent_color TEXT DEFAULT '#C6A256',
ADD COLUMN IF NOT EXISTS meta_title TEXT DEFAULT 'Drive 917 - Portal',
ADD COLUMN IF NOT EXISTS meta_description TEXT DEFAULT 'Fleet management portal',
ADD COLUMN IF NOT EXISTS og_image_url TEXT,
ADD COLUMN IF NOT EXISTS favicon_url TEXT,
ADD COLUMN IF NOT EXISTS light_background_color TEXT,
ADD COLUMN IF NOT EXISTS dark_background_color TEXT;

-- Add theme-specific color columns
ALTER TABLE org_settings
ADD COLUMN IF NOT EXISTS light_primary_color TEXT,
ADD COLUMN IF NOT EXISTS light_secondary_color TEXT,
ADD COLUMN IF NOT EXISTS light_accent_color TEXT,
ADD COLUMN IF NOT EXISTS dark_primary_color TEXT,
ADD COLUMN IF NOT EXISTS dark_secondary_color TEXT,
ADD COLUMN IF NOT EXISTS dark_accent_color TEXT;

-- Add header/footer colors
ALTER TABLE org_settings
ADD COLUMN IF NOT EXISTS light_header_footer_color TEXT,
ADD COLUMN IF NOT EXISTS dark_header_footer_color TEXT;

-- Add comments for documentation
COMMENT ON COLUMN org_settings.app_name IS 'Custom application name displayed in sidebar and browser';
COMMENT ON COLUMN org_settings.primary_color IS 'Primary brand color in hex format';
COMMENT ON COLUMN org_settings.secondary_color IS 'Secondary brand color in hex format';
COMMENT ON COLUMN org_settings.accent_color IS 'Accent color in hex format';
COMMENT ON COLUMN org_settings.meta_title IS 'SEO meta title for the application';
COMMENT ON COLUMN org_settings.meta_description IS 'SEO meta description for the application';
COMMENT ON COLUMN org_settings.og_image_url IS 'Open Graph image URL for social sharing';
COMMENT ON COLUMN org_settings.favicon_url IS 'Custom favicon URL';
COMMENT ON COLUMN org_settings.light_background_color IS 'Background color for light theme';
COMMENT ON COLUMN org_settings.dark_background_color IS 'Background color for dark theme';
COMMENT ON COLUMN org_settings.light_header_footer_color IS 'Header and footer background color for light theme (default: #1A2B25)';
COMMENT ON COLUMN org_settings.dark_header_footer_color IS 'Header and footer background color for dark theme (default: #1A2B25)';

-- Verify columns were added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'org_settings'
  AND column_name LIKE '%color%' OR column_name LIKE '%app_name%' OR column_name LIKE '%meta%'
ORDER BY ordinal_position;
