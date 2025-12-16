-- Add year column to vehicles table
ALTER TABLE vehicles ADD COLUMN year INTEGER;

-- Add a comment to document the column
COMMENT ON COLUMN vehicles.year IS 'Year of manufacture of the vehicle';