-- Create the fine-evidence storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('fine-evidence', 'fine-evidence', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload fine evidence"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'fine-evidence');

-- Allow authenticated users to read files
CREATE POLICY "Authenticated users can read fine evidence"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'fine-evidence');

-- Allow authenticated users to delete their uploads
CREATE POLICY "Authenticated users can delete fine evidence"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'fine-evidence');
