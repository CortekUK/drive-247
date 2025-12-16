-- Migration: Add key handover feature for rental agreements
-- This allows tracking car condition photos before and after rental

-- Create enum for handover type
DO $$ BEGIN
  CREATE TYPE key_handover_type AS ENUM ('giving', 'receiving');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create table for key handover records
CREATE TABLE IF NOT EXISTS rental_key_handovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id UUID NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  handover_type key_handover_type NOT NULL,
  notes TEXT,
  handed_at TIMESTAMPTZ,
  handed_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(rental_id, handover_type)
);

-- Create table for handover photos
CREATE TABLE IF NOT EXISTS rental_handover_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id UUID NOT NULL REFERENCES rental_key_handovers(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  caption TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  uploaded_by UUID REFERENCES app_users(id)
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_rental_key_handovers_rental_id ON rental_key_handovers(rental_id);
CREATE INDEX IF NOT EXISTS idx_rental_handover_photos_handover_id ON rental_handover_photos(handover_id);

-- Enable RLS
ALTER TABLE rental_key_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_handover_photos ENABLE ROW LEVEL SECURITY;

-- RLS Policies for rental_key_handovers
DROP POLICY IF EXISTS "Allow authenticated users to view handovers" ON rental_key_handovers;
CREATE POLICY "Allow authenticated users to view handovers" ON rental_key_handovers
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert handovers" ON rental_key_handovers;
CREATE POLICY "Allow authenticated users to insert handovers" ON rental_key_handovers
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to update handovers" ON rental_key_handovers;
CREATE POLICY "Allow authenticated users to update handovers" ON rental_key_handovers
  FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to delete handovers" ON rental_key_handovers;
CREATE POLICY "Allow authenticated users to delete handovers" ON rental_key_handovers
  FOR DELETE TO authenticated USING (true);

-- RLS Policies for rental_handover_photos
DROP POLICY IF EXISTS "Allow authenticated users to view photos" ON rental_handover_photos;
CREATE POLICY "Allow authenticated users to view photos" ON rental_handover_photos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert photos" ON rental_handover_photos;
CREATE POLICY "Allow authenticated users to insert photos" ON rental_handover_photos
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to update photos" ON rental_handover_photos;
CREATE POLICY "Allow authenticated users to update photos" ON rental_handover_photos
  FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to delete photos" ON rental_handover_photos;
CREATE POLICY "Allow authenticated users to delete photos" ON rental_handover_photos
  FOR DELETE TO authenticated USING (true);

-- Create storage bucket for handover photos if not exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('rental-handover-photos', 'rental-handover-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for rental-handover-photos bucket
DROP POLICY IF EXISTS "Allow authenticated uploads to rental-handover-photos" ON storage.objects;
CREATE POLICY "Allow authenticated uploads to rental-handover-photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rental-handover-photos');

DROP POLICY IF EXISTS "Allow public reads from rental-handover-photos" ON storage.objects;
CREATE POLICY "Allow public reads from rental-handover-photos" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'rental-handover-photos');

DROP POLICY IF EXISTS "Allow authenticated deletes from rental-handover-photos" ON storage.objects;
CREATE POLICY "Allow authenticated deletes from rental-handover-photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'rental-handover-photos');

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_rental_key_handovers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_rental_key_handovers_updated_at ON rental_key_handovers;
CREATE TRIGGER trigger_update_rental_key_handovers_updated_at
  BEFORE UPDATE ON rental_key_handovers
  FOR EACH ROW
  EXECUTE FUNCTION update_rental_key_handovers_updated_at();

COMMENT ON TABLE rental_key_handovers IS 'Tracks key handover events for rentals - when keys are given to customer and received back';
COMMENT ON TABLE rental_handover_photos IS 'Photos documenting car condition at time of key handover';
COMMENT ON COLUMN rental_key_handovers.handover_type IS 'giving = owner gives key to renter, receiving = owner receives key back from renter';
COMMENT ON COLUMN rental_key_handovers.handed_at IS 'Timestamp when keys were actually handed over (null until key handed button clicked)';
