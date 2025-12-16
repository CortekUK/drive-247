-- Add branding customization fields to org_settings
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

-- Add comment for documentation
COMMENT ON COLUMN org_settings.app_name IS 'Custom application name displayed in sidebar and browser';
COMMENT ON COLUMN org_settings.primary_color IS 'Primary brand color in hex format';
COMMENT ON COLUMN org_settings.secondary_color IS 'Secondary brand color in hex format';
COMMENT ON COLUMN org_settings.accent_color IS 'Accent color in hex format';
COMMENT ON COLUMN org_settings.meta_title IS 'SEO meta title for the application';
COMMENT ON COLUMN org_settings.meta_description IS 'SEO meta description for the application';
COMMENT ON COLUMN org_settings.og_image_url IS 'Open Graph image URL for social sharing';
COMMENT ON COLUMN org_settings.favicon_url IS 'Custom favicon URL';
