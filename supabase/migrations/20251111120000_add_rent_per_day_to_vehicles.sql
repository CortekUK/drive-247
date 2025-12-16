-- Add rent_per_day column to vehicles table
ALTER TABLE vehicles
ADD COLUMN rent_per_day numeric(10,2);

-- Add comment to the column
COMMENT ON COLUMN vehicles.rent_per_day IS 'Daily rental rate for the vehicle';
