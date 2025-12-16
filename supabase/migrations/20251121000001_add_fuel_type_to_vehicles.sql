-- Add fuel_type column to vehicles table
ALTER TABLE public.vehicles
ADD COLUMN IF NOT EXISTS fuel_type TEXT CHECK (fuel_type IN ('Petrol', 'Diesel', 'Hybrid', 'Electric'));

-- Set default value for existing vehicles
UPDATE public.vehicles
SET fuel_type = 'Petrol'
WHERE fuel_type IS NULL;

-- Add comment
COMMENT ON COLUMN public.vehicles.fuel_type IS 'Type of fuel the vehicle uses: Petrol, Diesel, Hybrid, or Electric';
