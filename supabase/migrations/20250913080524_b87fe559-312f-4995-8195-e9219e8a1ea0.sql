-- Add customer documents table for storing customer documents and IDs
CREATE TABLE IF NOT EXISTS public.customer_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('National Insurance', 'Driving Licence', 'Insurance Certificate', 'Address Proof', 'Other')),
  document_name TEXT NOT NULL,
  file_url TEXT,
  file_name TEXT,
  insurance_provider TEXT, -- For insurance certificates
  policy_number TEXT,      -- For insurance certificates
  policy_start_date DATE,  -- For insurance certificates
  policy_end_date DATE,    -- For insurance certificates
  notes TEXT,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.customer_documents ENABLE ROW LEVEL SECURITY;

-- Create RLS policy
CREATE POLICY "Allow all operations for authenticated users" ON public.customer_documents
FOR ALL USING (true);

-- Add indexes for performance
CREATE INDEX idx_customer_documents_customer_id ON public.customer_documents(customer_id);
CREATE INDEX idx_customer_documents_type ON public.customer_documents(document_type);