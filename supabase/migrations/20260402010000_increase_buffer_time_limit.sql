-- Increase buffer time limit from 480 minutes (8 hours) to 4320 minutes (72 hours)
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS buffer_time_minutes_range;
ALTER TABLE tenants ADD CONSTRAINT buffer_time_minutes_range CHECK (buffer_time_minutes >= 0 AND buffer_time_minutes <= 4320);
