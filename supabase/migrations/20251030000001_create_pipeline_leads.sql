-- Create pipeline/leads table for tracking potential customers
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  status TEXT NOT NULL DEFAULT 'New',
  source TEXT,
  notes TEXT,
  expected_value NUMERIC(12,2),
  follow_up_date DATE,
  assigned_to UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_to_customer_id UUID REFERENCES public.customers(id),
  converted_at TIMESTAMPTZ
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON public.leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_follow_up_date ON public.leads(follow_up_date);
CREATE INDEX IF NOT EXISTS idx_leads_converted_customer ON public.leads(converted_to_customer_id);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trigger_update_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION update_leads_updated_at();

-- Enable RLS
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow authenticated users full access
CREATE POLICY "Allow authenticated users to manage leads"
  ON public.leads
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Add helpful comments
COMMENT ON TABLE public.leads IS 'Pipeline/leads tracking for potential customers';
COMMENT ON COLUMN public.leads.status IS 'Lead status: New, In Progress, Completed, Declined';
COMMENT ON COLUMN public.leads.source IS 'How the lead was acquired: Referral, Website, Cold Call, etc.';
COMMENT ON COLUMN public.leads.converted_to_customer_id IS 'Customer ID if lead was converted';