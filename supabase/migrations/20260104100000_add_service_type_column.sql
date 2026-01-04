-- Add service_type column to service_records table
ALTER TABLE service_records
ADD COLUMN IF NOT EXISTS service_type TEXT;

-- Add a comment describing the column
COMMENT ON COLUMN service_records.service_type IS 'Type of service performed (e.g., Oil Change, Tire Rotation, Brake Service, etc.)';
