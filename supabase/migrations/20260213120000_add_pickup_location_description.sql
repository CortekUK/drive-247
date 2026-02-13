-- Add optional description field to pickup_locations
ALTER TABLE pickup_locations ADD COLUMN IF NOT EXISTS description TEXT;
