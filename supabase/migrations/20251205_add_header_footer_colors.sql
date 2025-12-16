-- Add header/footer color columns to org_settings table
-- These columns allow separate header/footer colors for light and dark modes

ALTER TABLE org_settings
ADD COLUMN IF NOT EXISTS light_header_footer_color TEXT,
ADD COLUMN IF NOT EXISTS dark_header_footer_color TEXT;

-- Add comments for documentation
COMMENT ON COLUMN org_settings.light_header_footer_color IS 'Header and footer background color for light theme (default: #1A2B25)';
COMMENT ON COLUMN org_settings.dark_header_footer_color IS 'Header and footer background color for dark theme (default: #1A2B25)';
