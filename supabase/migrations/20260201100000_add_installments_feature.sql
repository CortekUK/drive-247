-- ============================================================================
-- INSTALLMENTS FEATURE MIGRATION
-- Adds support for splitting rental payments into scheduled installments
-- ============================================================================

-- ============================================================================
-- EXTEND TENANTS TABLE
-- Add installment configuration settings
-- ============================================================================

ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS installments_enabled BOOLEAN DEFAULT false;

ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS installment_config JSONB DEFAULT '{
  "min_days_for_weekly": 7,
  "min_days_for_monthly": 30,
  "max_installments_weekly": 4,
  "max_installments_monthly": 6
}'::jsonb;

COMMENT ON COLUMN tenants.installments_enabled IS 'Whether installment payments are enabled for this tenant';
COMMENT ON COLUMN tenants.installment_config IS 'Configuration for installment options: min_days_for_weekly, min_days_for_monthly, max_installments_weekly, max_installments_monthly';

-- ============================================================================
-- EXTEND CUSTOMERS TABLE
-- Add Stripe customer ID for card-on-file functionality
-- ============================================================================

ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

COMMENT ON COLUMN customers.stripe_customer_id IS 'Stripe Customer ID for saved payment methods';

CREATE INDEX IF NOT EXISTS idx_customers_stripe_customer_id
ON customers(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- ============================================================================
-- INSTALLMENT PLANS TABLE
-- Stores the installment plan configuration for each rental
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.installment_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rental_id UUID NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

    -- Plan configuration
    plan_type TEXT NOT NULL CHECK (plan_type IN ('full', 'weekly', 'monthly')),
    total_installable_amount NUMERIC(12,2) NOT NULL,
    number_of_installments INTEGER NOT NULL CHECK (number_of_installments >= 1),
    installment_amount NUMERIC(12,2) NOT NULL,

    -- Upfront payment tracking
    upfront_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    upfront_paid BOOLEAN DEFAULT false,
    upfront_payment_id UUID REFERENCES payments(id),

    -- Stripe card-on-file
    stripe_customer_id TEXT,
    stripe_payment_method_id TEXT,
    stripe_setup_intent_id TEXT,

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled', 'overdue')),

    -- Progress tracking
    paid_installments INTEGER DEFAULT 0,
    total_paid NUMERIC(12,2) DEFAULT 0,
    next_due_date DATE,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_installment_plans_rental ON installment_plans(rental_id);
CREATE INDEX IF NOT EXISTS idx_installment_plans_tenant ON installment_plans(tenant_id);
CREATE INDEX IF NOT EXISTS idx_installment_plans_customer ON installment_plans(customer_id);
CREATE INDEX IF NOT EXISTS idx_installment_plans_status ON installment_plans(status);
CREATE INDEX IF NOT EXISTS idx_installment_plans_next_due ON installment_plans(next_due_date)
    WHERE status = 'active';

COMMENT ON TABLE installment_plans IS 'Stores installment payment plans for rentals';

-- ============================================================================
-- SCHEDULED INSTALLMENTS TABLE
-- Tracks individual scheduled payments within an installment plan
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.scheduled_installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    installment_plan_id UUID NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rental_id UUID NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

    -- Installment details
    installment_number INTEGER NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    due_date DATE NOT NULL,

    -- Payment status
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'processing', 'paid', 'failed', 'overdue', 'cancelled')),

    -- Stripe payment references
    stripe_payment_intent_id TEXT,
    stripe_charge_id TEXT,

    -- Link to payment record once paid
    payment_id UUID REFERENCES payments(id),
    ledger_entry_id UUID REFERENCES ledger_entries(id),

    -- Failure tracking for retry logic
    failure_count INTEGER DEFAULT 0,
    last_failure_reason TEXT,
    last_attempted_at TIMESTAMPTZ,

    -- Completion tracking
    paid_at TIMESTAMPTZ,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure unique installment numbers per plan
    UNIQUE(installment_plan_id, installment_number)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_scheduled_installments_plan ON scheduled_installments(installment_plan_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_installments_tenant ON scheduled_installments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_installments_rental ON scheduled_installments(rental_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_installments_customer ON scheduled_installments(customer_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_installments_status ON scheduled_installments(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_installments_due ON scheduled_installments(due_date)
    WHERE status IN ('scheduled', 'overdue');
CREATE INDEX IF NOT EXISTS idx_scheduled_installments_processing ON scheduled_installments(status, due_date)
    WHERE status = 'scheduled';

COMMENT ON TABLE scheduled_installments IS 'Individual scheduled payments within an installment plan';

-- ============================================================================
-- EXTEND RENTALS TABLE
-- Add installment plan reference
-- ============================================================================

ALTER TABLE public.rentals
ADD COLUMN IF NOT EXISTS has_installment_plan BOOLEAN DEFAULT false;

ALTER TABLE public.rentals
ADD COLUMN IF NOT EXISTS installment_plan_id UUID REFERENCES installment_plans(id);

COMMENT ON COLUMN rentals.has_installment_plan IS 'Whether this rental uses an installment payment plan';
COMMENT ON COLUMN rentals.installment_plan_id IS 'Reference to the associated installment plan';

CREATE INDEX IF NOT EXISTS idx_rentals_installment_plan
ON rentals(installment_plan_id) WHERE installment_plan_id IS NOT NULL;

-- ============================================================================
-- UPDATE TIMESTAMP TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_installment_plans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_installment_plans_updated_at ON installment_plans;
CREATE TRIGGER trigger_installment_plans_updated_at
    BEFORE UPDATE ON installment_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_installment_plans_updated_at();

CREATE OR REPLACE FUNCTION update_scheduled_installments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_scheduled_installments_updated_at ON scheduled_installments;
CREATE TRIGGER trigger_scheduled_installments_updated_at
    BEFORE UPDATE ON scheduled_installments
    FOR EACH ROW
    EXECUTE FUNCTION update_scheduled_installments_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE installment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_installments ENABLE ROW LEVEL SECURITY;

-- Installment Plans Policies
DROP POLICY IF EXISTS "Service role can manage installment_plans" ON installment_plans;
CREATE POLICY "Service role can manage installment_plans"
    ON installment_plans
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Tenant users can view their installment_plans" ON installment_plans;
CREATE POLICY "Tenant users can view their installment_plans"
    ON installment_plans
    FOR SELECT
    TO authenticated
    USING (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Tenant users can insert installment_plans" ON installment_plans;
CREATE POLICY "Tenant users can insert installment_plans"
    ON installment_plans
    FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Tenant users can update their installment_plans" ON installment_plans;
CREATE POLICY "Tenant users can update their installment_plans"
    ON installment_plans
    FOR UPDATE
    TO authenticated
    USING (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
    );

-- Anonymous access for booking app
DROP POLICY IF EXISTS "Anon can insert installment_plans for bookings" ON installment_plans;
CREATE POLICY "Anon can insert installment_plans for bookings"
    ON installment_plans
    FOR INSERT
    TO anon
    WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can view installment_plans" ON installment_plans;
CREATE POLICY "Anon can view installment_plans"
    ON installment_plans
    FOR SELECT
    TO anon
    USING (true);

-- Scheduled Installments Policies
DROP POLICY IF EXISTS "Service role can manage scheduled_installments" ON scheduled_installments;
CREATE POLICY "Service role can manage scheduled_installments"
    ON scheduled_installments
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Tenant users can view their scheduled_installments" ON scheduled_installments;
CREATE POLICY "Tenant users can view their scheduled_installments"
    ON scheduled_installments
    FOR SELECT
    TO authenticated
    USING (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Tenant users can insert scheduled_installments" ON scheduled_installments;
CREATE POLICY "Tenant users can insert scheduled_installments"
    ON scheduled_installments
    FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Tenant users can update their scheduled_installments" ON scheduled_installments;
CREATE POLICY "Tenant users can update their scheduled_installments"
    ON scheduled_installments
    FOR UPDATE
    TO authenticated
    USING (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
    );

-- Anonymous access for booking app
DROP POLICY IF EXISTS "Anon can insert scheduled_installments for bookings" ON scheduled_installments;
CREATE POLICY "Anon can insert scheduled_installments for bookings"
    ON scheduled_installments
    FOR INSERT
    TO anon
    WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can view scheduled_installments" ON scheduled_installments;
CREATE POLICY "Anon can view scheduled_installments"
    ON scheduled_installments
    FOR SELECT
    TO anon
    USING (true);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to create an installment plan with scheduled payments
CREATE OR REPLACE FUNCTION create_installment_plan(
    p_rental_id UUID,
    p_tenant_id UUID,
    p_customer_id UUID,
    p_plan_type TEXT,
    p_total_installable_amount NUMERIC,
    p_upfront_amount NUMERIC,
    p_number_of_installments INTEGER,
    p_start_date DATE,
    p_stripe_customer_id TEXT DEFAULT NULL,
    p_stripe_payment_method_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_plan_id UUID;
    v_installment_amount NUMERIC;
    v_due_date DATE;
    v_interval INTERVAL;
    i INTEGER;
BEGIN
    -- Calculate installment amount (evenly divided)
    v_installment_amount := ROUND(p_total_installable_amount / p_number_of_installments, 2);

    -- Determine interval based on plan type
    IF p_plan_type = 'weekly' THEN
        v_interval := INTERVAL '7 days';
    ELSIF p_plan_type = 'monthly' THEN
        v_interval := INTERVAL '1 month';
    ELSE
        -- For 'full' payment, single installment due immediately
        v_interval := INTERVAL '0 days';
    END IF;

    -- Create the installment plan
    INSERT INTO installment_plans (
        rental_id, tenant_id, customer_id, plan_type,
        total_installable_amount, number_of_installments, installment_amount,
        upfront_amount, stripe_customer_id, stripe_payment_method_id,
        status, next_due_date
    ) VALUES (
        p_rental_id, p_tenant_id, p_customer_id, p_plan_type,
        p_total_installable_amount, p_number_of_installments, v_installment_amount,
        p_upfront_amount, p_stripe_customer_id, p_stripe_payment_method_id,
        'active', p_start_date
    )
    RETURNING id INTO v_plan_id;

    -- Create scheduled installments
    v_due_date := p_start_date;
    FOR i IN 1..p_number_of_installments LOOP
        INSERT INTO scheduled_installments (
            installment_plan_id, tenant_id, rental_id, customer_id,
            installment_number, amount, due_date, status
        ) VALUES (
            v_plan_id, p_tenant_id, p_rental_id, p_customer_id,
            i, v_installment_amount, v_due_date, 'scheduled'
        );

        v_due_date := v_due_date + v_interval;
    END LOOP;

    -- Update rental with installment plan reference
    UPDATE rentals
    SET has_installment_plan = true, installment_plan_id = v_plan_id
    WHERE id = p_rental_id;

    RETURN v_plan_id;
END;
$$;

-- Function to get due installments for processing
CREATE OR REPLACE FUNCTION get_due_installments(p_process_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    id UUID,
    installment_plan_id UUID,
    tenant_id UUID,
    rental_id UUID,
    customer_id UUID,
    installment_number INTEGER,
    amount NUMERIC,
    due_date DATE,
    stripe_customer_id TEXT,
    stripe_payment_method_id TEXT
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
        ip.stripe_customer_id,
        ip.stripe_payment_method_id
    FROM scheduled_installments si
    JOIN installment_plans ip ON si.installment_plan_id = ip.id
    WHERE si.due_date <= p_process_date
        AND si.status = 'scheduled'
        AND ip.status = 'active'
        AND ip.stripe_payment_method_id IS NOT NULL
    ORDER BY si.due_date ASC, si.installment_number ASC;
END;
$$;

-- Function to mark installment as paid
CREATE OR REPLACE FUNCTION mark_installment_paid(
    p_installment_id UUID,
    p_payment_id UUID,
    p_ledger_entry_id UUID DEFAULT NULL,
    p_stripe_payment_intent_id TEXT DEFAULT NULL,
    p_stripe_charge_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_plan_id UUID;
    v_total_installments INTEGER;
    v_paid_installments INTEGER;
BEGIN
    -- Update the scheduled installment
    UPDATE scheduled_installments
    SET status = 'paid',
        paid_at = NOW(),
        payment_id = p_payment_id,
        ledger_entry_id = p_ledger_entry_id,
        stripe_payment_intent_id = p_stripe_payment_intent_id,
        stripe_charge_id = p_stripe_charge_id
    WHERE id = p_installment_id
    RETURNING installment_plan_id INTO v_plan_id;

    IF v_plan_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Update the installment plan
    SELECT number_of_installments INTO v_total_installments
    FROM installment_plans WHERE id = v_plan_id;

    SELECT COUNT(*) INTO v_paid_installments
    FROM scheduled_installments
    WHERE installment_plan_id = v_plan_id AND status = 'paid';

    UPDATE installment_plans
    SET paid_installments = v_paid_installments,
        total_paid = total_paid + (SELECT amount FROM scheduled_installments WHERE id = p_installment_id),
        next_due_date = (
            SELECT MIN(due_date)
            FROM scheduled_installments
            WHERE installment_plan_id = v_plan_id AND status = 'scheduled'
        ),
        status = CASE
            WHEN v_paid_installments >= v_total_installments THEN 'completed'
            ELSE status
        END
    WHERE id = v_plan_id;

    RETURN TRUE;
END;
$$;

-- Function to mark installment as failed
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

    -- Check if should be marked overdue (failed 3+ times AND overdue by 3+ days)
    IF v_failure_count >= 3 AND v_due_date < CURRENT_DATE - INTERVAL '3 days' THEN
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

-- Function to get installment plan summary for a rental
CREATE OR REPLACE FUNCTION get_installment_plan_summary(p_rental_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'plan', jsonb_build_object(
            'id', ip.id,
            'plan_type', ip.plan_type,
            'status', ip.status,
            'total_installable_amount', ip.total_installable_amount,
            'upfront_amount', ip.upfront_amount,
            'number_of_installments', ip.number_of_installments,
            'installment_amount', ip.installment_amount,
            'paid_installments', ip.paid_installments,
            'total_paid', ip.total_paid,
            'next_due_date', ip.next_due_date,
            'created_at', ip.created_at
        ),
        'installments', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', si.id,
                    'installment_number', si.installment_number,
                    'amount', si.amount,
                    'due_date', si.due_date,
                    'status', si.status,
                    'paid_at', si.paid_at,
                    'failure_count', si.failure_count,
                    'last_failure_reason', si.last_failure_reason
                ) ORDER BY si.installment_number
            )
            FROM scheduled_installments si
            WHERE si.installment_plan_id = ip.id
        ),
        'payment_method', jsonb_build_object(
            'stripe_customer_id', ip.stripe_customer_id,
            'has_payment_method', ip.stripe_payment_method_id IS NOT NULL
        )
    ) INTO v_result
    FROM installment_plans ip
    WHERE ip.rental_id = p_rental_id;

    RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- Function to cancel an installment plan
CREATE OR REPLACE FUNCTION cancel_installment_plan(
    p_plan_id UUID,
    p_reason TEXT DEFAULT 'Cancelled by admin'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Cancel all pending scheduled installments
    UPDATE scheduled_installments
    SET status = 'cancelled',
        last_failure_reason = p_reason
    WHERE installment_plan_id = p_plan_id
        AND status IN ('scheduled', 'failed', 'overdue');

    -- Update plan status
    UPDATE installment_plans
    SET status = 'cancelled'
    WHERE id = p_plan_id;

    -- Update rental
    UPDATE rentals
    SET has_installment_plan = false
    WHERE installment_plan_id = p_plan_id;

    RETURN TRUE;
END;
$$;

-- ============================================================================
-- GRANT EXECUTE PERMISSIONS ON FUNCTIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION create_installment_plan TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION get_due_installments TO service_role;
GRANT EXECUTE ON FUNCTION mark_installment_paid TO service_role;
GRANT EXECUTE ON FUNCTION mark_installment_failed TO service_role;
GRANT EXECUTE ON FUNCTION get_installment_plan_summary TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION cancel_installment_plan TO service_role, authenticated;
