-- Add booking_payment_mode column if it doesn't exist
ALTER TABLE org_settings
ADD COLUMN IF NOT EXISTS booking_payment_mode TEXT DEFAULT 'manual';

-- Verify all settings columns exist
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'org_settings'
ORDER BY ordinal_position;
