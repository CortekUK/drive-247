-- Add buffer time between rentals (per-tenant setting)
-- When a rental ends, the vehicle stays unavailable for this many minutes
-- Default 0 means no buffer (current behavior)
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS buffer_time_minutes integer NOT NULL DEFAULT 0;

-- Add a check constraint to keep it reasonable (0-480 minutes = 0-8 hours)
ALTER TABLE tenants
ADD CONSTRAINT buffer_time_minutes_range CHECK (buffer_time_minutes >= 0 AND buffer_time_minutes <= 480);
