-- Add platform subscription fields to tenants
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_subscription_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'basic';

-- Tenant subscriptions table
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'incomplete'
    CHECK (status IN ('incomplete','active','past_due','canceled','unpaid','trialing','paused')),
  plan_name TEXT NOT NULL DEFAULT 'pro',
  amount INTEGER NOT NULL DEFAULT 20000, -- cents
  currency TEXT NOT NULL DEFAULT 'usd',
  interval TEXT NOT NULL DEFAULT 'month',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  card_brand TEXT,
  card_last4 TEXT,
  card_exp_month INTEGER,
  card_exp_year INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active/trialing subscription per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_subscriptions_active
  ON tenant_subscriptions (tenant_id)
  WHERE status IN ('active', 'trialing', 'past_due');

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant
  ON tenant_subscriptions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_stripe_customer
  ON tenant_subscriptions (stripe_customer_id);

-- Tenant subscription invoices table
CREATE TABLE IF NOT EXISTS tenant_subscription_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES tenant_subscriptions(id) ON DELETE SET NULL,
  stripe_invoice_id TEXT NOT NULL UNIQUE,
  stripe_invoice_pdf TEXT,
  stripe_hosted_invoice_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','open','paid','void','uncollectible')),
  amount_due INTEGER NOT NULL DEFAULT 0,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  due_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  invoice_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_subscription_invoices_tenant
  ON tenant_subscription_invoices (tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenant_subscription_invoices_subscription
  ON tenant_subscription_invoices (subscription_id);

-- updated_at trigger (only create if not already defined)
DO $$ BEGIN
  CREATE FUNCTION update_updated_at_column()
  RETURNS TRIGGER AS $fn$
  BEGIN
    NEW.updated_at = now();
    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;
EXCEPTION WHEN duplicate_function THEN
  -- Function already exists, nothing to do
  NULL;
END $$;

DROP TRIGGER IF EXISTS set_updated_at_tenant_subscriptions ON tenant_subscriptions;
CREATE TRIGGER set_updated_at_tenant_subscriptions
  BEFORE UPDATE ON tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_tenant_subscription_invoices ON tenant_subscription_invoices;
CREATE TRIGGER set_updated_at_tenant_subscription_invoices
  BEFORE UPDATE ON tenant_subscription_invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscription_invoices ENABLE ROW LEVEL SECURITY;

-- Tenant users can read their own subscriptions
CREATE POLICY "Tenant users can view own subscriptions"
  ON tenant_subscriptions FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

-- Only service_role can insert/update/delete subscriptions (via edge functions)
CREATE POLICY "Service role manages subscriptions"
  ON tenant_subscriptions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Tenant users can read their own invoices
CREATE POLICY "Tenant users can view own invoices"
  ON tenant_subscription_invoices FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

-- Only service_role can insert/update/delete invoices (via edge functions)
CREATE POLICY "Service role manages invoices"
  ON tenant_subscription_invoices FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
