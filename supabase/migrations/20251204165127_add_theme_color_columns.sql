-- Add theme-specific color columns to org_settings table
-- These columns allow separate color schemes for light and dark modes

-- Add theme-specific primary, secondary, and accent colors
ALTER TABLE org_settings
ADD COLUMN IF NOT EXISTS light_primary_color TEXT,
ADD COLUMN IF NOT EXISTS light_secondary_color TEXT,
ADD COLUMN IF NOT EXISTS light_accent_color TEXT,
ADD COLUMN IF NOT EXISTS dark_primary_color TEXT,
ADD COLUMN IF NOT EXISTS dark_secondary_color TEXT,
ADD COLUMN IF NOT EXISTS dark_accent_color TEXT;

-- Add comments for documentation
COMMENT ON COLUMN org_settings.light_primary_color IS 'Primary brand color for light theme mode';
COMMENT ON COLUMN org_settings.light_secondary_color IS 'Secondary color for light theme mode';
COMMENT ON COLUMN org_settings.light_accent_color IS 'Accent color for light theme mode';
COMMENT ON COLUMN org_settings.dark_primary_color IS 'Primary brand color for dark theme mode';
COMMENT ON COLUMN org_settings.dark_secondary_color IS 'Secondary color for dark theme mode';
COMMENT ON COLUMN org_settings.dark_accent_color IS 'Accent color for dark theme mode';
