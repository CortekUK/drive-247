-- Create plates table for managing license plates (with proper policy handling)
CREATE TABLE IF NOT EXISTS public.plates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number TEXT NOT NULL UNIQUE,
  retention_doc_reference TEXT,
  assigned_vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  notes TEXT,
  document_url TEXT,
  document_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.plates ENABLE ROW LEVEL SECURITY;

-- Create RLS policy only if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'plates' 
    AND policyname = 'Allow all operations for authenticated users'
  ) THEN
    CREATE POLICY "Allow all operations for authenticated users" ON public.plates
    FOR ALL USING (true);
  END IF;
END $$;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_plates_plate_number ON public.plates(plate_number);
CREATE INDEX IF NOT EXISTS idx_plates_assigned_vehicle ON public.plates(assigned_vehicle_id);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_plates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates (drop first if exists)
DROP TRIGGER IF EXISTS update_plates_updated_at ON public.plates;
CREATE TRIGGER update_plates_updated_at
BEFORE UPDATE ON public.plates
FOR EACH ROW
EXECUTE FUNCTION public.update_plates_updated_at();