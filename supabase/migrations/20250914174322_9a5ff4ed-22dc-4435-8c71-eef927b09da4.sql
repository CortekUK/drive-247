-- Extend org_settings table with test metadata and logo support
ALTER TABLE org_settings 
ADD COLUMN IF NOT EXISTS logo_url text,
ADD COLUMN IF NOT EXISTS tests_last_run_dashboard timestamp with time zone,
ADD COLUMN IF NOT EXISTS tests_last_result_dashboard jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS tests_last_run_rental timestamp with time zone,
ADD COLUMN IF NOT EXISTS tests_last_result_rental jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS tests_last_run_finance timestamp with time zone,
ADD COLUMN IF NOT EXISTS tests_last_result_finance jsonb DEFAULT '{}';

-- Create company logos storage bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for company logos
CREATE POLICY "Company logos are publicly accessible" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'company-logos');

CREATE POLICY "Authenticated users can upload company logos" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'company-logos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update company logos" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'company-logos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete company logos" 
ON storage.objects FOR DELETE 
USING (bucket_id = 'company-logos' AND auth.role() = 'authenticated');