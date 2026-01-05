-- Add VIN (Vehicle Identification Number) column to vehicles table
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vin TEXT;

-- Add comment for documentation
COMMENT ON COLUMN vehicles.vin IS 'Vehicle Identification Number (VIN) - optional 17-character identifier';
