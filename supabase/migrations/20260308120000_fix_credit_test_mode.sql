-- Fix test mode credit deductions: actually deduct from test_balance
-- Fix add_credits: support p_is_test_mode parameter
-- Rename sms category to twilio
-- Auto-grant test credits to new tenants

-- =============================================================================
-- 1. Rename sms → twilio in credit_costs
-- =============================================================================
UPDATE credit_costs
SET category = 'twilio', label = 'Twilio (WhatsApp/SMS)'
WHERE category = 'sms';

-- =============================================================================
-- 2. Fix deduct_credits() — test mode now deducts from test_balance
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
  -- Get the cost for this category
  SELECT cost_credits INTO v_cost FROM credit_costs WHERE category = p_category AND is_active = true;

  IF v_cost IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown or inactive service category: ' || p_category);
  END IF;

  -- Lock the wallet row (or create if doesn't exist)
  SELECT * INTO v_wallet FROM tenant_credit_wallets WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO tenant_credit_wallets (tenant_id, balance) VALUES (p_tenant_id, 0)
    RETURNING * INTO v_wallet;
  END IF;

  IF p_is_test_mode THEN
    -- Test mode: deduct from test_balance
    IF v_wallet.test_balance < v_cost THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Insufficient test credits',
        'balance', v_wallet.test_balance,
        'required', v_cost,
        'category', p_category,
        'test_mode', true
      );
    END IF;

    v_new_balance := v_wallet.test_balance - v_cost;

    UPDATE tenant_credit_wallets
    SET test_balance = v_new_balance,
        test_lifetime_used = test_lifetime_used + v_cost
    WHERE id = v_wallet.id;

    INSERT INTO credit_transactions (tenant_id, wallet_id, type, amount, balance_after, category, description, reference_id, reference_type, is_test_mode)
    VALUES (p_tenant_id, v_wallet.id, 'usage', -v_cost, v_new_balance, p_category, p_description, p_reference_id, p_reference_type, true)
    RETURNING id INTO v_transaction_id;

    RETURN jsonb_build_object(
      'success', true,
      'test_mode', true,
      'amount_deducted', v_cost,
      'balance_after', v_new_balance,
      'transaction_id', v_transaction_id
    );
  END IF;

  -- Live mode: deduct from balance
  IF v_wallet.balance < v_cost THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient credits',
      'balance', v_wallet.balance,
      'required', v_cost,
      'category', p_category,
      'test_mode', false
    );
  END IF;

  v_new_balance := v_wallet.balance - v_cost;

  UPDATE tenant_credit_wallets
  SET balance = v_new_balance,
      lifetime_used = lifetime_used + v_cost
  WHERE id = v_wallet.id;

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
-- 3. Fix add_credits() — support p_is_test_mode parameter
-- =============================================================================
CREATE OR REPLACE FUNCTION add_credits(
  p_tenant_id UUID,
  p_amount NUMERIC(10,2),
  p_type credit_transaction_type,
  p_description TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_package_id UUID DEFAULT NULL,
  p_stripe_payment_id TEXT DEFAULT NULL,
  p_performed_by UUID DEFAULT NULL,
  p_is_test_mode BOOLEAN DEFAULT false
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

  IF p_is_test_mode THEN
    -- Test mode: add to test_balance
    v_new_balance := v_wallet.test_balance + p_amount;

    UPDATE tenant_credit_wallets
    SET test_balance = v_new_balance,
        test_lifetime_purchased = CASE WHEN p_type IN ('purchase', 'auto_refill', 'gift') THEN test_lifetime_purchased + p_amount ELSE test_lifetime_purchased END
    WHERE id = v_wallet.id;
  ELSE
    -- Live mode: add to balance
    v_new_balance := v_wallet.balance + p_amount;

    UPDATE tenant_credit_wallets
    SET balance = v_new_balance,
        lifetime_purchased = CASE WHEN p_type IN ('purchase', 'auto_refill', 'gift') THEN lifetime_purchased + p_amount ELSE lifetime_purchased END
    WHERE id = v_wallet.id;
  END IF;

  INSERT INTO credit_transactions (tenant_id, wallet_id, type, amount, balance_after, category, description, package_id, stripe_payment_id, performed_by, is_test_mode)
  VALUES (p_tenant_id, v_wallet.id, p_type, p_amount, v_new_balance, p_category, p_description, p_package_id, p_stripe_payment_id, p_performed_by, p_is_test_mode)
  RETURNING id INTO v_transaction_id;

  RETURN jsonb_build_object(
    'success', true,
    'amount_added', p_amount,
    'balance_after', v_new_balance,
    'transaction_id', v_transaction_id,
    'test_mode', p_is_test_mode
  );
END;
$$;

-- =============================================================================
-- 4. Auto-grant test credits to new tenants
-- =============================================================================
CREATE OR REPLACE FUNCTION initialize_tenant_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet_id UUID;
BEGIN
  INSERT INTO tenant_credit_wallets (tenant_id, balance, test_balance)
  VALUES (NEW.id, 0, 1000)
  ON CONFLICT (tenant_id) DO NOTHING
  RETURNING id INTO v_wallet_id;

  -- Log the gift transaction if wallet was created
  IF v_wallet_id IS NOT NULL THEN
    INSERT INTO credit_transactions (tenant_id, wallet_id, type, amount, balance_after, description, is_test_mode)
    VALUES (NEW.id, v_wallet_id, 'gift', 1000, 1000, 'Welcome bonus: 1000 test credits', true);
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger (drop first in case it exists)
DROP TRIGGER IF EXISTS on_tenant_created_init_wallet ON tenants;
CREATE TRIGGER on_tenant_created_init_wallet
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION initialize_tenant_wallet();
