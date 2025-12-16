-- Test script to verify color changes are being saved

-- Check current org_settings values
SELECT
  id,
  app_name,
  primary_color,
  secondary_color,
  accent_color,
  light_primary_color,
  dark_primary_color,
  updated_at
FROM org_settings
LIMIT 1;

-- Test: Update primary color to blue (like FleetVana)
UPDATE org_settings
SET
  primary_color = '#3B82F6',
  updated_at = now()
WHERE id IS NOT NULL;

-- Verify the update
SELECT
  app_name,
  primary_color,
  secondary_color,
  accent_color,
  updated_at
FROM org_settings
LIMIT 1;
