-- Subscription plans table: per-tenant pricing controlled by super admin
CREATE TABLE subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  features JSONB NOT NULL DEFAULT '[]',
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  interval TEXT NOT NULL DEFAULT 'month',
  stripe_price_id TEXT,
  stripe_product_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_subscription_plans_tenant_id ON subscription_plans(tenant_id);
CREATE INDEX idx_subscription_plans_stripe_price_id ON subscription_plans(stripe_price_id);

-- Auto-update trigger
DROP TRIGGER IF EXISTS set_updated_at_subscription_plans ON subscription_plans;
CREATE TRIGGER set_updated_at_subscription_plans
  BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;

-- Tenants can view their own active plans
CREATE POLICY "Tenants can view own plans"
  ON subscription_plans FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- Only service_role can manage plans (edge functions)
CREATE POLICY "Service role manages plans"
  ON subscription_plans FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Add plan_id reference to tenant_subscriptions
ALTER TABLE tenant_subscriptions
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES subscription_plans(id);
