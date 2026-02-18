-- Add excess mileage rate to vehicles table
-- Used alongside allowed_mileage to calculate charges when rental exceeds the included mileage
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS excess_mileage_rate NUMERIC(10,2) DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN vehicles.excess_mileage_rate IS 'Price per mile/km charged when rental exceeds allowed_mileage';
COMMENT ON COLUMN vehicles.allowed_mileage IS 'Included mileage per rental (no charge). NULL means unlimited';
