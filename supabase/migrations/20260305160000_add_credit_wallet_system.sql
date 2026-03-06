-- Credit Wallet System
-- Replaces Stripe metered billing with a prepaid credit-based system

-- =============================================================================
-- 1. Credit Packages (global, managed by super admin)
-- =============================================================================
CREATE TABLE IF NOT EXISTS credit_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  credits INTEGER NOT NULL,
  bonus_credits INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  stripe_price_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_popular BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE credit_packages ENABLE ROW LEVEL SECURITY;

-- Everyone can read active packages
CREATE POLICY "Anyone can read active credit packages"
  ON credit_packages FOR SELECT
  USING (is_active = true);

-- Only service_role can manage
CREATE POLICY "Service role manages credit packages"
  ON credit_packages FOR ALL
  USING (auth.role() = 'service_role');

CREATE TRIGGER set_credit_packages_updated_at
  BEFORE UPDATE ON credit_packages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 2. Credit Costs (per-service pricing, managed by super admin)
-- =============================================================================
CREATE TABLE IF NOT EXISTS credit_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL UNIQUE,
  cost_credits NUMERIC(10,2) NOT NULL DEFAULT 1.0,
  label TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE credit_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read credit costs"
  ON credit_costs FOR SELECT
  USING (true);

CREATE POLICY "Service role manages credit costs"
  ON credit_costs FOR ALL
  USING (auth.role() = 'service_role');

CREATE TRIGGER set_credit_costs_updated_at
  BEFORE UPDATE ON credit_costs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed default costs
INSERT INTO credit_costs (category, cost_credits, label, description) VALUES
  ('esign', 1.0, 'E-Sign Agreement', 'Cost per e-signature agreement sent'),
  ('sms', 0.5, 'SMS Notification', 'Cost per SMS message sent'),
  ('ocr', 2.0, 'Document OCR', 'Cost per document OCR scan'),
  ('verification', 3.0, 'Identity Verification', 'Cost per identity verification check')
ON CONFLICT (category) DO NOTHING;

-- =============================================================================
-- 3. Tenant Credit Wallets (one per tenant)
-- =============================================================================
CREATE TABLE IF NOT EXISTS tenant_credit_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_purchased NUMERIC(12,2) NOT NULL DEFAULT 0,
  lifetime_used NUMERIC(12,2) NOT NULL DEFAULT 0,
  low_balance_threshold INTEGER NOT NULL DEFAULT 10,
  auto_refill_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_refill_threshold INTEGER NOT NULL DEFAULT 10,
  auto_refill_amount INTEGER NOT NULL DEFAULT 50,
  auto_refill_package_id UUID REFERENCES credit_packages(id),
  stripe_payment_method_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id)
);

ALTER TABLE tenant_credit_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants can read own wallet"
  ON tenant_credit_wallets FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Service role manages wallets"
  ON tenant_credit_wallets FOR ALL
  USING (auth.role() = 'service_role');

CREATE TRIGGER set_tenant_credit_wallets_updated_at
  BEFORE UPDATE ON tenant_credit_wallets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 4. Credit Transactions (immutable ledger)
-- =============================================================================
CREATE TYPE credit_transaction_type AS ENUM (
  'purchase', 'usage', 'refund', 'gift', 'adjustment', 'auto_refill'
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES tenant_credit_wallets(id) ON DELETE CASCADE,
  type credit_transaction_type NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  category TEXT,
  description TEXT,
  reference_id UUID,
  reference_type TEXT,
  package_id UUID REFERENCES credit_packages(id),
  stripe_payment_id TEXT,
  performed_by UUID REFERENCES app_users(id),
  is_test_mode BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants can read own transactions"
  ON credit_transactions FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Service role manages transactions"
  ON credit_transactions FOR ALL
  USING (auth.role() = 'service_role');

-- Index for fast lookups
CREATE INDEX idx_credit_transactions_tenant ON credit_transactions(tenant_id, created_at DESC);
CREATE INDEX idx_credit_transactions_category ON credit_transactions(tenant_id, category, created_at DESC);

-- =============================================================================
-- 5. Atomic deduct_credits function
-- =============================================================================
CREATE OR REPLACE FUNCTION deduct_credits(
  p_tenant_id UUID,
  p_category TEXT,
  p_description TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_is_test_mode BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet tenant_credit_wallets%ROWTYPE;
  v_cost NUMERIC(10,2);
  v_new_balance NUMERIC(12,2);
  v_transaction_id UUID;
BEGIN
  -- Skip deduction in test mode
  IF p_is_test_mode THEN
    -- Get wallet for balance_after (or create if doesn't exist)
    SELECT * INTO v_wallet FROM tenant_credit_wallets WHERE tenant_id = p_tenant_id FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO tenant_credit_wallets (tenant_id, balance) VALUES (p_tenant_id, 0)
      RETURNING * INTO v_wallet;
    END IF;

    -- Log test usage with 0 cost
    INSERT INTO credit_transactions (tenant_id, wallet_id, type, amount, balance_after, category, description, reference_id, reference_type, is_test_mode)
    VALUES (p_tenant_id, v_wallet.id, 'usage', 0, v_wallet.balance, p_category, COALESCE(p_description, 'Test mode - no charge'), p_reference_id, p_reference_type, true)
    RETURNING id INTO v_transaction_id;

    RETURN jsonb_build_object(
      'success', true,
      'test_mode', true,
      'amount_deducted', 0,
      'balance_after', v_wallet.balance,
      'transaction_id', v_transaction_id
    );
  END IF;

  -- Get the cost for this category
  SELECT cost_credits INTO v_cost FROM credit_costs WHERE category = p_category AND is_active = true;

  IF v_cost IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown or inactive service category: ' || p_category);
  END IF;

  -- Lock the wallet row
  SELECT * INTO v_wallet FROM tenant_credit_wallets WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No credit wallet found for tenant');
  END IF;

  -- Check sufficient balance
  IF v_wallet.balance < v_cost THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient credits',
      'balance', v_wallet.balance,
      'required', v_cost,
      'category', p_category
    );
  END IF;

  -- Deduct
  v_new_balance := v_wallet.balance - v_cost;

  UPDATE tenant_credit_wallets
  SET balance = v_new_balance,
      lifetime_used = lifetime_used + v_cost
  WHERE id = v_wallet.id;

  -- Log transaction
  INSERT INTO credit_transactions (tenant_id, wallet_id, type, amount, balance_after, category, description, reference_id, reference_type, is_test_mode)
  VALUES (p_tenant_id, v_wallet.id, 'usage', -v_cost, v_new_balance, p_category, p_description, p_reference_id, p_reference_type, false)
  RETURNING id INTO v_transaction_id;

  RETURN jsonb_build_object(
    'success', true,
    'test_mode', false,
    'amount_deducted', v_cost,
    'balance_after', v_new_balance,
    'transaction_id', v_transaction_id,
    'auto_refill_needed', v_wallet.auto_refill_enabled AND v_new_balance <= v_wallet.auto_refill_threshold
  );
END;
$$;

-- =============================================================================
-- 6. Add credits function (for purchases, gifts, refunds, auto-refill)
-- =============================================================================
CREATE OR REPLACE FUNCTION add_credits(
  p_tenant_id UUID,
  p_amount NUMERIC(10,2),
  p_type credit_transaction_type,
  p_description TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_package_id UUID DEFAULT NULL,
  p_stripe_payment_id TEXT DEFAULT NULL,
  p_performed_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet tenant_credit_wallets%ROWTYPE;
  v_new_balance NUMERIC(12,2);
  v_transaction_id UUID;
BEGIN
  -- Lock wallet or create if doesn't exist
  SELECT * INTO v_wallet FROM tenant_credit_wallets WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO tenant_credit_wallets (tenant_id, balance) VALUES (p_tenant_id, 0)
    RETURNING * INTO v_wallet;
  END IF;

  v_new_balance := v_wallet.balance + p_amount;

  UPDATE tenant_credit_wallets
  SET balance = v_new_balance,
      lifetime_purchased = CASE WHEN p_type IN ('purchase', 'auto_refill', 'gift') THEN lifetime_purchased + p_amount ELSE lifetime_purchased END
  WHERE id = v_wallet.id;

  INSERT INTO credit_transactions (tenant_id, wallet_id, type, amount, balance_after, category, description, package_id, stripe_payment_id, performed_by)
  VALUES (p_tenant_id, v_wallet.id, p_type, p_amount, v_new_balance, p_category, p_description, p_package_id, p_stripe_payment_id, p_performed_by)
  RETURNING id INTO v_transaction_id;

  RETURN jsonb_build_object(
    'success', true,
    'amount_added', p_amount,
    'balance_after', v_new_balance,
    'transaction_id', v_transaction_id
  );
END;
$$;

-- =============================================================================
-- 7. Seed default credit packages
-- =============================================================================
INSERT INTO credit_packages (name, credits, bonus_credits, price_cents, currency, sort_order, is_popular) VALUES
  ('Starter', 10, 0, 1000, 'usd', 1, false),
  ('Growth', 50, 5, 4500, 'usd', 2, false),
  ('Business', 100, 15, 8500, 'usd', 3, true),
  ('Enterprise', 500, 100, 40000, 'usd', 4, false);
