-- Create vehicle_photos table for multiple photos per vehicle
CREATE TABLE IF NOT EXISTS public.vehicle_photos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_vehicle_photos_vehicle_id ON public.vehicle_photos(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_photos_display_order ON public.vehicle_photos(vehicle_id, display_order);

-- Enable Row Level Security
ALTER TABLE public.vehicle_photos ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Anyone can view vehicle photos"
  ON public.vehicle_photos FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert vehicle photos"
  ON public.vehicle_photos FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update vehicle photos"
  ON public.vehicle_photos FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can delete vehicle photos"
  ON public.vehicle_photos FOR DELETE
  USING (true);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_vehicle_photos_updated_at
  BEFORE UPDATE ON public.vehicle_photos
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Migrate existing photo_url data to vehicle_photos table
INSERT INTO public.vehicle_photos (vehicle_id, photo_url, display_order)
SELECT id, photo_url, 0
FROM public.vehicles
WHERE photo_url IS NOT NULL AND photo_url != '';

-- Note: Keep the photo_url column in vehicles table for backward compatibility
-- It can be removed in a future migration if needed
-- ALTER TABLE public.vehicles DROP COLUMN IF EXISTS photo_url;
