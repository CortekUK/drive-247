-- Migration: Create contact_requests table for SAAS landing page
-- Description: Store contact form submissions from potential rental companies

CREATE TABLE IF NOT EXISTS contact_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  message TEXT,
  status TEXT DEFAULT 'pending',  -- 'pending', 'contacted', 'converted', 'rejected'
  created_at TIMESTAMPTZ DEFAULT now(),
  notes TEXT,                      -- Super admin internal notes

  -- Constraints
  CONSTRAINT valid_status CHECK (status IN ('pending', 'contacted', 'converted', 'rejected')),
  CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_contact_requests_status ON contact_requests(status);
CREATE INDEX IF NOT EXISTS idx_contact_requests_created_at ON contact_requests(created_at DESC);

-- Enable RLS
ALTER TABLE contact_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Only super admins can view/manage contact requests
CREATE POLICY "super_admin_manage_contact_requests" ON contact_requests
FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Public can insert contact requests (from landing page form)
CREATE POLICY "public_insert_contact_requests" ON contact_requests
FOR INSERT
WITH CHECK (true);

-- Add helpful comments
COMMENT ON TABLE contact_requests IS 'Contact form submissions from SAAS landing page';
COMMENT ON COLUMN contact_requests.status IS 'pending: new request, contacted: in progress, converted: became customer, rejected: not a fit';
COMMENT ON COLUMN contact_requests.notes IS 'Internal notes for super admin (not visible to requester)';
