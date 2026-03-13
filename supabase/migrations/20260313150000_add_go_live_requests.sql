-- Go-live requests: tenants request switching integrations from test → live mode
-- Generic table to support Stripe Connect, Bonzah, BoldSign, and future integrations

CREATE TABLE IF NOT EXISTS go_live_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  integration_type TEXT NOT NULL, -- 'stripe_connect', 'bonzah', 'boldsign', etc.
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  note TEXT, -- optional message from tenant
  admin_note TEXT, -- optional response from super admin
  reviewed_by UUID REFERENCES app_users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one pending request per tenant per integration type
CREATE UNIQUE INDEX idx_go_live_requests_pending
  ON go_live_requests (tenant_id, integration_type)
  WHERE status = 'pending';

-- Indexes for common queries
CREATE INDEX idx_go_live_requests_tenant ON go_live_requests (tenant_id);
CREATE INDEX idx_go_live_requests_status ON go_live_requests (status);

-- Updated_at trigger
CREATE TRIGGER set_go_live_requests_updated_at
  BEFORE UPDATE ON go_live_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE go_live_requests ENABLE ROW LEVEL SECURITY;

-- Tenants can read their own requests
CREATE POLICY "Tenants can view own go-live requests"
  ON go_live_requests
  FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- Tenants can insert their own requests
CREATE POLICY "Tenants can create go-live requests"
  ON go_live_requests
  FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- Super admins can view all requests
CREATE POLICY "Super admins can view all go-live requests"
  ON go_live_requests
  FOR SELECT
  USING (is_super_admin());

-- Super admins can update requests (approve/reject)
CREATE POLICY "Super admins can update go-live requests"
  ON go_live_requests
  FOR UPDATE
  USING (is_super_admin());
