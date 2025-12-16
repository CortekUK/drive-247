-- Add description column to vehicles table
ALTER TABLE public.vehicles
ADD COLUMN IF NOT EXISTS description TEXT;

-- Add comment to describe the column
COMMENT ON COLUMN public.vehicles.description IS 'Detailed description of the vehicle, including special features, condition notes, etc.';
