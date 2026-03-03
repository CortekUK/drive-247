-- =============================================================================
-- E-Sign Usage Log + Invoice Usage Columns
-- Tracks metered BoldSign usage per tenant for Stripe billing
-- =============================================================================

-- esign_usage_log: one row per live e-sign agreement sent
CREATE TABLE IF NOT EXISTS esign_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rental_id UUID REFERENCES rentals(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT,
  rental_ref TEXT,
  unit_cost NUMERIC(10,2) NOT NULL DEFAULT 1.00,
  currency TEXT NOT NULL DEFAULT 'usd',
  stripe_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_esign_usage_log_tenant_id ON esign_usage_log(tenant_id);
CREATE INDEX idx_esign_usage_log_created_at ON esign_usage_log(tenant_id, created_at DESC);

-- RLS
ALTER TABLE esign_usage_log ENABLE ROW LEVEL SECURITY;

-- Tenants can read their own usage logs
CREATE POLICY "Tenants can view own esign usage"
  ON esign_usage_log FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- Only service_role can insert (edge functions / API routes)
CREATE POLICY "Service role can insert esign usage"
  ON esign_usage_log FOR INSERT
  WITH CHECK (true);

-- Add usage breakdown columns to tenant_subscription_invoices
ALTER TABLE tenant_subscription_invoices
  ADD COLUMN IF NOT EXISTS base_amount INTEGER,
  ADD COLUMN IF NOT EXISTS usage_amount INTEGER,
  ADD COLUMN IF NOT EXISTS usage_quantity INTEGER;

-- Comment for clarity
COMMENT ON TABLE esign_usage_log IS 'Tracks each live e-sign agreement sent for metered billing';
COMMENT ON COLUMN esign_usage_log.unit_cost IS 'Cost per agreement at time of event ($1.00)';
COMMENT ON COLUMN esign_usage_log.stripe_event_id IS 'Stripe meter event ID for reconciliation';
COMMENT ON COLUMN tenant_subscription_invoices.base_amount IS 'Fixed subscription portion in cents';
COMMENT ON COLUMN tenant_subscription_invoices.usage_amount IS 'Metered usage portion in cents';
COMMENT ON COLUMN tenant_subscription_invoices.usage_quantity IS 'Number of metered units (e-signs) in billing period';
