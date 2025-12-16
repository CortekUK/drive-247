-- Extend org_settings table with test metadata and logo support
ALTER TABLE org_settings 
ADD COLUMN IF NOT EXISTS logo_url text,
ADD COLUMN IF NOT EXISTS tests_last_run_dashboard timestamp with time zone,
ADD COLUMN IF NOT EXISTS tests_last_result_dashboard jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS tests_last_run_rental timestamp with time zone,
ADD COLUMN IF NOT EXISTS tests_last_result_rental jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS tests_last_run_finance timestamp with time zone,
ADD COLUMN IF NOT EXISTS tests_last_result_finance jsonb DEFAULT '{}';

-- Create company logos storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public) 
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO NOTHING;