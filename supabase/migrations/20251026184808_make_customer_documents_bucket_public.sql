-- Make customer-documents storage bucket public
UPDATE storage.buckets
SET public = true
WHERE id = 'customer-documents';
