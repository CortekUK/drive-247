-- Create insurance policies table
CREATE TABLE public.insurance_policies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  vehicle_id UUID NULL REFERENCES public.vehicles(id) ON DELETE SET NULL,
  policy_number TEXT NOT NULL,
  provider TEXT,
  start_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Expired', 'Suspended', 'Cancelled')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create insurance documents table
CREATE TABLE public.insurance_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_id UUID NOT NULL REFERENCES public.insurance_policies(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_insurance_customer ON public.insurance_policies(customer_id);
CREATE INDEX IF NOT EXISTS idx_insurance_vehicle ON public.insurance_policies(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_insurance_expiry ON public.insurance_policies(expiry_date);
CREATE INDEX IF NOT EXISTS idx_insurance_status ON public.insurance_policies(status);

-- Add unique_key column to reminder_events for idempotent reminder generation
ALTER TABLE public.reminder_events ADD COLUMN IF NOT EXISTS unique_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_unique_key ON public.reminder_events(unique_key) WHERE unique_key IS NOT NULL;

-- Create insurance documents storage bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('insurance-docs', 'insurance-docs', false)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for insurance documents
CREATE POLICY "Allow authenticated users to view insurance documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'insurance-docs' AND auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to upload insurance documents"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'insurance-docs' AND auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to update insurance documents"
ON storage.objects FOR UPDATE
USING (bucket_id = 'insurance-docs' AND auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to delete insurance documents"
ON storage.objects FOR DELETE
USING (bucket_id = 'insurance-docs' AND auth.role() = 'authenticated');

-- Enable RLS on insurance tables
ALTER TABLE public.insurance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_documents ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for insurance_policies
CREATE POLICY "Allow all operations for app users on insurance_policies"
ON public.insurance_policies FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Create RLS policies for insurance_documents
CREATE POLICY "Allow all operations for app users on insurance_documents"
ON public.insurance_documents FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_insurance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_insurance_policies_updated_at
  BEFORE UPDATE ON public.insurance_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_insurance_updated_at();