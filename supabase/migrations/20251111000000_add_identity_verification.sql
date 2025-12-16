-- Create identity_verifications table
CREATE TABLE IF NOT EXISTS identity_verifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- Provider data (Veriff, Stripe Identity, etc.)
  provider TEXT NOT NULL DEFAULT 'veriff', -- Verification provider
  session_id TEXT, -- Provider session ID
  verification_token TEXT, -- Provider verification token
  external_user_id TEXT, -- External reference

  -- Verification status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'init', 'pending', 'queued', 'completed', 'onHold')),
  review_status TEXT CHECK (review_status IN ('init', 'pending', 'prechecked', 'queued', 'completed', 'onHold')),
  review_result TEXT CHECK (review_result IN ('GREEN', 'RED', 'RETRY')),

  -- Document information
  document_type TEXT, -- e.g., 'DRIVERS_LICENSE', 'ID_CARD', 'PASSPORT'
  document_number TEXT,
  document_country TEXT,
  document_issuing_date DATE,
  document_expiry_date DATE,

  -- Extracted personal information
  first_name TEXT,
  last_name TEXT,
  date_of_birth DATE,
  address TEXT,

  -- Verification details
  verification_url TEXT, -- URL for customer to complete verification
  verification_completed_at TIMESTAMP WITH TIME ZONE,
  verified_by UUID REFERENCES auth.users(id),

  -- Review comments and rejection reasons
  rejection_reason TEXT,
  rejection_labels TEXT[], -- Array of rejection labels
  client_comment TEXT,
  moderator_comment TEXT,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for fast lookups
CREATE INDEX idx_identity_verifications_customer_id ON identity_verifications(customer_id);
CREATE INDEX idx_identity_verifications_session_id ON identity_verifications(session_id);
CREATE INDEX idx_identity_verifications_status ON identity_verifications(status);
CREATE INDEX idx_identity_verifications_provider ON identity_verifications(provider);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_identity_verifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER identity_verifications_updated_at
  BEFORE UPDATE ON identity_verifications
  FOR EACH ROW
  EXECUTE FUNCTION update_identity_verifications_updated_at();

-- Add RLS policies
ALTER TABLE identity_verifications ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view identity verifications
CREATE POLICY "Allow authenticated users to view identity verifications"
  ON identity_verifications
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert identity verifications
CREATE POLICY "Allow authenticated users to insert identity verifications"
  ON identity_verifications
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update identity verifications
CREATE POLICY "Allow authenticated users to update identity verifications"
  ON identity_verifications
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow service role full access
CREATE POLICY "Allow service role full access to identity verifications"
  ON identity_verifications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add verification status column to customers table
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS identity_verification_status TEXT DEFAULT 'unverified' CHECK (identity_verification_status IN ('unverified', 'pending', 'verified', 'rejected'));

-- Add index on verification status
CREATE INDEX IF NOT EXISTS idx_customers_identity_verification_status ON customers(identity_verification_status);

COMMENT ON TABLE identity_verifications IS 'Stores identity verification data from various providers (Veriff, Stripe Identity, etc.) for customers';
COMMENT ON COLUMN identity_verifications.session_id IS 'Provider session identifier';
COMMENT ON COLUMN identity_verifications.review_result IS 'GREEN = approved, RED = rejected, RETRY = needs resubmission';
