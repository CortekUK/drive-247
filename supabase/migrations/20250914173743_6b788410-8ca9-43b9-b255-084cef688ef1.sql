-- Create vehicle photos storage bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('vehicle-photos', 'vehicle-photos', true);

-- Add photo_url column to vehicles table
ALTER TABLE public.vehicles 
ADD COLUMN photo_url TEXT;

-- Create RLS policies for vehicle photos bucket
CREATE POLICY "Anyone can view vehicle photos" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'vehicle-photos');

CREATE POLICY "Anyone can upload vehicle photos" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'vehicle-photos');

CREATE POLICY "Anyone can update vehicle photos" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'vehicle-photos');

CREATE POLICY "Anyone can delete vehicle photos" 
ON storage.objects FOR DELETE 
USING (bucket_id = 'vehicle-photos');