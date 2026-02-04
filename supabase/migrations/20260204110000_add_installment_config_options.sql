-- ============================================================================
-- PHASE 3: INSTALLMENT CONFIG OPTIONS MIGRATION
-- Adds advanced configuration options for installment plans:
-- - charge_first_upfront: Whether to collect first installment at checkout
-- - what_gets_split: What costs are included in installments
-- - grace_period_days: Days before marking overdue
-- - max_retry_attempts: Max retries for failed payments
-- - retry_interval_days: Days between retry attempts
-- ============================================================================

-- ============================================================================
-- ADD CONFIG COLUMN TO INSTALLMENT_PLANS
-- ============================================================================

ALTER TABLE public.installment_plans
ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{
  "charge_first_upfront": true,
  "what_gets_split": "rental_tax",
  "grace_period_days": 3,
  "max_retry_attempts": 3,
  "retry_interval_days": 1
}'::jsonb;

COMMENT ON COLUMN installment_plans.config IS 'Configuration settings for the installment plan: charge_first_upfront, what_gets_split, grace_period_days, max_retry_attempts, retry_interval_days';

-- ============================================================================
-- UPDATE mark_installment_failed FUNCTION
-- Use config from plan instead of hardcoded values
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_installment_failed(
    p_installment_id UUID,
    p_failure_reason TEXT,
    p_stripe_payment_intent_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_plan_id UUID;
    v_failure_count INTEGER;
    v_due_date DATE;
    v_grace_period INTEGER;
    v_max_retries INTEGER;
BEGIN
    -- Update the scheduled installment
    UPDATE scheduled_installments
    SET status = 'failed',
        failure_count = failure_count + 1,
        last_failure_reason = p_failure_reason,
        last_attempted_at = NOW(),
        stripe_payment_intent_id = p_stripe_payment_intent_id
    WHERE id = p_installment_id
    RETURNING installment_plan_id, failure_count, due_date
    INTO v_plan_id, v_failure_count, v_due_date;

    IF v_plan_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Get config from plan (with defaults)
    SELECT
        COALESCE((ip.config->>'grace_period_days')::INTEGER, 3),
        COALESCE((ip.config->>'max_retry_attempts')::INTEGER, 3)
    INTO v_grace_period, v_max_retries
    FROM installment_plans ip
    WHERE ip.id = v_plan_id;

    -- Check if should be marked overdue
    -- Using config values instead of hardcoded 3
    IF v_failure_count >= v_max_retries AND v_due_date < CURRENT_DATE - (v_grace_period || ' days')::INTERVAL THEN
        UPDATE scheduled_installments
        SET status = 'overdue'
        WHERE id = p_installment_id;

        -- Update plan status if any installment is overdue
        UPDATE installment_plans
        SET status = 'overdue'
        WHERE id = v_plan_id;
    END IF;

    RETURN TRUE;
END;
$$;

-- ============================================================================
-- ADD FUNCTION TO GET INSTALLMENTS FOR RETRY
-- Gets failed installments that are eligible for retry based on config
-- ============================================================================

CREATE OR REPLACE FUNCTION get_installments_for_retry(p_process_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    id UUID,
    installment_plan_id UUID,
    tenant_id UUID,
    rental_id UUID,
    customer_id UUID,
    installment_number INTEGER,
    amount NUMERIC,
    due_date DATE,
    failure_count INTEGER,
    last_attempted_at TIMESTAMPTZ,
    stripe_customer_id TEXT,
    stripe_payment_method_id TEXT,
    retry_interval_days INTEGER,
    max_retry_attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        si.id,
        si.installment_plan_id,
        si.tenant_id,
        si.rental_id,
        si.customer_id,
        si.installment_number,
        si.amount,
        si.due_date,
        si.failure_count,
        si.last_attempted_at,
        ip.stripe_customer_id,
        ip.stripe_payment_method_id,
        COALESCE((ip.config->>'retry_interval_days')::INTEGER, 1) as retry_interval_days,
        COALESCE((ip.config->>'max_retry_attempts')::INTEGER, 3) as max_retry_attempts
    FROM scheduled_installments si
    JOIN installment_plans ip ON si.installment_plan_id = ip.id
    WHERE si.status = 'failed'
        AND ip.status IN ('active', 'overdue')
        AND ip.stripe_payment_method_id IS NOT NULL
        -- Only retry if within max attempts
        AND si.failure_count < COALESCE((ip.config->>'max_retry_attempts')::INTEGER, 3)
        -- Only retry if enough time has passed since last attempt
        AND (
            si.last_attempted_at IS NULL
            OR si.last_attempted_at < NOW() - (COALESCE((ip.config->>'retry_interval_days')::INTEGER, 1) || ' days')::INTERVAL
        )
    ORDER BY si.due_date ASC, si.installment_number ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_installments_for_retry TO service_role;

COMMENT ON FUNCTION get_installments_for_retry IS 'Gets failed installments that are eligible for retry based on their plan config';

-- ============================================================================
-- UPDATE TENANTS INSTALLMENT_CONFIG DEFAULT
-- Add new fields to the default JSON
-- ============================================================================

-- Update the default value for existing tenants that have installments enabled
-- This adds the new fields while preserving existing settings
UPDATE public.tenants
SET installment_config = installment_config || '{
  "charge_first_upfront": true,
  "what_gets_split": "rental_tax",
  "grace_period_days": 3,
  "max_retry_attempts": 3,
  "retry_interval_days": 1
}'::jsonb
WHERE installments_enabled = true
AND NOT (installment_config ? 'grace_period_days');

-- Update the column default to include new fields
ALTER TABLE public.tenants
ALTER COLUMN installment_config SET DEFAULT '{
  "min_days_for_weekly": 7,
  "min_days_for_monthly": 30,
  "max_installments_weekly": 4,
  "max_installments_monthly": 6,
  "charge_first_upfront": true,
  "what_gets_split": "rental_tax",
  "grace_period_days": 3,
  "max_retry_attempts": 3,
  "retry_interval_days": 1
}'::jsonb;

COMMENT ON COLUMN tenants.installment_config IS 'Configuration for installment options: min_days_for_weekly, min_days_for_monthly, max_installments_weekly, max_installments_monthly, charge_first_upfront, what_gets_split, grace_period_days, max_retry_attempts, retry_interval_days';
