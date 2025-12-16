-- Extend customer_documents table to match full specification
ALTER TABLE customer_documents 
ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS file_size bigint,
ADD COLUMN IF NOT EXISTS mime_type text,
ADD COLUMN IF NOT EXISTS start_date date,
ADD COLUMN IF NOT EXISTS end_date date,
ADD COLUMN IF NOT EXISTS status text CHECK (status IN ('Active','Expired','Pending','Unknown')),
ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false;

-- Update document_type constraint to include all specified types
ALTER TABLE customer_documents DROP CONSTRAINT IF EXISTS customer_documents_document_type_check;
ALTER TABLE customer_documents ADD CONSTRAINT customer_documents_document_type_check 
CHECK (document_type IN ('Insurance Certificate','Driving Licence','National Insurance','Address Proof','ID Card/Passport','Other'));

-- Create customer-documents storage bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('customer-documents', 'customer-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for customer-documents bucket
CREATE POLICY "Authenticated users can view customer documents" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'customer-documents' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can upload customer documents" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'customer-documents' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update customer documents" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'customer-documents' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete customer documents" 
ON storage.objects FOR DELETE 
USING (bucket_id = 'customer-documents' AND auth.role() = 'authenticated');

-- Migrate existing insurance_policies data to customer_documents
INSERT INTO customer_documents (
  customer_id, 
  vehicle_id,
  document_type, 
  document_name, 
  insurance_provider, 
  policy_number,
  start_date,
  end_date,
  status,
  notes,
  created_at,
  updated_at
)
SELECT 
  customer_id,
  vehicle_id,
  'Insurance Certificate' as document_type,
  COALESCE('Policy ' || policy_number, 'Insurance Policy') as document_name,
  provider as insurance_provider,
  policy_number,
  start_date,
  expiry_date as end_date,
  status,
  notes,
  created_at,
  updated_at
FROM insurance_policies
ON CONFLICT DO NOTHING;

-- Add updated_at trigger for customer_documents
CREATE OR REPLACE FUNCTION update_customer_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_customer_documents_updated_at
  BEFORE UPDATE ON customer_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_documents_updated_at();