-- Add service plan and spare key tracking columns to vehicles table
ALTER TABLE vehicles 
ADD COLUMN has_service_plan boolean DEFAULT false,
ADD COLUMN has_spare_key boolean DEFAULT false,
ADD COLUMN spare_key_holder text,
ADD COLUMN spare_key_notes text;

-- Add check constraint for spare_key_holder
ALTER TABLE vehicles ADD CONSTRAINT chk_spare_key_holder 
CHECK (spare_key_holder IS NULL OR spare_key_holder IN ('Company', 'Customer'));