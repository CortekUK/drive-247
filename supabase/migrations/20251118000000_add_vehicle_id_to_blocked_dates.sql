-- Add vehicle_id column to blocked_dates table for vehicle-specific blocking
ALTER TABLE blocked_dates
ADD COLUMN vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE;

-- Create index for vehicle_id lookups
CREATE INDEX idx_blocked_dates_vehicle ON blocked_dates(vehicle_id);

-- Create index for combined vehicle and date lookups
CREATE INDEX idx_blocked_dates_vehicle_range ON blocked_dates(vehicle_id, start_date, end_date);

-- Update table comment to reflect new functionality
COMMENT ON TABLE blocked_dates IS 'Stores date ranges that are blocked globally (vehicle_id=NULL) or for specific vehicles';
COMMENT ON COLUMN blocked_dates.vehicle_id IS 'Optional vehicle ID for vehicle-specific blocks. NULL means blocked for all vehicles';
