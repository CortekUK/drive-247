-- CheckMyDriver (CMD) / Modives verification tracking table
-- Stores insurance and driver's license verification requests and results

CREATE TABLE IF NOT EXISTS cmd_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rental_id UUID NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  verification_type TEXT NOT NULL CHECK (verification_type IN ('insurance', 'license')),

  -- Modives API identifiers
  cmd_verification_id TEXT,
  applicant_verification_req_guid_id TEXT,
  applicant_verification_id TEXT,

  -- Magic link
  magic_link_url TEXT,
  magic_link_generated_at TIMESTAMPTZ,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'link_generated', 'link_sent', 'verifying',
    'verified', 'unverified', 'valid', 'invalid', 'expired', 'error'
  )),

  -- Consumer info sent to CMD
  consumer_first_name TEXT,
  consumer_last_name TEXT,
  consumer_email TEXT,
  consumer_phone TEXT,

  -- Insurance verification results
  policy_status TEXT,
  active_status TEXT,
  carrier TEXT,
  is_monitoring BOOLEAN DEFAULT false,

  -- License verification results
  license_status TEXT,

  -- Webhook data
  webhook_payload JSONB,
  webhook_received_at TIMESTAMPTZ,

  -- Full results from GET /verification-results
  verification_results JSONB,

  -- Error tracking
  error_message TEXT,

  -- Admin who initiated
  initiated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cmd_verifications_tenant_id ON cmd_verifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cmd_verifications_rental_id ON cmd_verifications(rental_id);
CREATE INDEX IF NOT EXISTS idx_cmd_verifications_customer_id ON cmd_verifications(customer_id);
CREATE INDEX IF NOT EXISTS idx_cmd_verifications_cmd_verification_id ON cmd_verifications(cmd_verification_id);
CREATE INDEX IF NOT EXISTS idx_cmd_verifications_applicant_verification_id ON cmd_verifications(applicant_verification_id);
CREATE INDEX IF NOT EXISTS idx_cmd_verifications_type_status ON cmd_verifications(verification_type, status);

-- Updated at trigger
DROP TRIGGER IF EXISTS set_updated_at_cmd_verifications ON cmd_verifications;
CREATE TRIGGER set_updated_at_cmd_verifications
  BEFORE UPDATE ON cmd_verifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE cmd_verifications ENABLE ROW LEVEL SECURITY;

-- Authenticated users can SELECT rows scoped to their tenant
CREATE POLICY "Tenant users can view cmd_verifications"
  ON cmd_verifications FOR SELECT
  TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- Authenticated users can INSERT rows scoped to their tenant
CREATE POLICY "Tenant users can insert cmd_verifications"
  ON cmd_verifications FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- Service role has full access (for edge functions / webhooks)
CREATE POLICY "Service role full access to cmd_verifications"
  ON cmd_verifications FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to update their tenant's rows
CREATE POLICY "Tenant users can update cmd_verifications"
  ON cmd_verifications FOR UPDATE
  TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());
