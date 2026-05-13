-- ============================================
-- Vehicle Owners & Payouts
-- Allows tenants to manage third-party-owned vehicles, track
-- per-owner revenue, and record manual payouts with commission.
-- ============================================

-- ============================================
-- 1. vehicle_owners
-- ============================================
CREATE TABLE IF NOT EXISTS public.vehicle_owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,

  commission_type TEXT NOT NULL DEFAULT 'percentage',
  commission_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  flat_fee_period TEXT,
  payout_frequency TEXT NOT NULL DEFAULT 'biweekly',

  is_active BOOLEAN NOT NULL DEFAULT true,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT vehicle_owners_commission_type_chk
    CHECK (commission_type IN ('percentage', 'flat_fee')),
  CONSTRAINT vehicle_owners_commission_value_chk
    CHECK (commission_value >= 0
           AND (commission_type = 'flat_fee' OR commission_value <= 100)),
  CONSTRAINT vehicle_owners_flat_period_chk
    CHECK (commission_type = 'percentage'
           OR flat_fee_period IN ('per_rental', 'per_month')),
  CONSTRAINT vehicle_owners_payout_frequency_chk
    CHECK (payout_frequency IN ('weekly', 'biweekly', 'monthly', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_vehicle_owners_tenant_id
  ON public.vehicle_owners(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_owners_active
  ON public.vehicle_owners(tenant_id, is_active);

ALTER TABLE public.vehicle_owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant users view own vehicle owners" ON public.vehicle_owners;
CREATE POLICY "Tenant users view own vehicle owners"
  ON public.vehicle_owners FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users insert vehicle owners" ON public.vehicle_owners;
CREATE POLICY "Tenant users insert vehicle owners"
  ON public.vehicle_owners FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users update vehicle owners" ON public.vehicle_owners;
CREATE POLICY "Tenant users update vehicle owners"
  ON public.vehicle_owners FOR UPDATE
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users delete vehicle owners" ON public.vehicle_owners;
CREATE POLICY "Tenant users delete vehicle owners"
  ON public.vehicle_owners FOR DELETE
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP TRIGGER IF EXISTS set_vehicle_owners_updated_at ON public.vehicle_owners;
CREATE TRIGGER set_vehicle_owners_updated_at
  BEFORE UPDATE ON public.vehicle_owners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================
-- 2. vehicles: add ownership columns
-- ============================================
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS owner_id UUID
    REFERENCES public.vehicle_owners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ownership_assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS commission_type_override TEXT,
  ADD COLUMN IF NOT EXISTS commission_value_override NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS flat_fee_period_override TEXT;

ALTER TABLE public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_commission_override_chk;
ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_commission_override_chk
  CHECK (
    (commission_type_override IS NULL
     OR commission_type_override IN ('percentage', 'flat_fee'))
    AND (flat_fee_period_override IS NULL
         OR flat_fee_period_override IN ('per_rental', 'per_month'))
    AND (commission_value_override IS NULL OR commission_value_override >= 0)
  );

CREATE INDEX IF NOT EXISTS idx_vehicles_owner_id
  ON public.vehicles(owner_id) WHERE owner_id IS NOT NULL;

-- ============================================
-- 3. owner_payouts (header)
-- ============================================
CREATE TABLE IF NOT EXISTS public.owner_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.vehicle_owners(id) ON DELETE RESTRICT,

  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  gross_revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  refund_adjustments NUMERIC(12, 2) NOT NULL DEFAULT 0,
  net_owed NUMERIC(12, 2) NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'pending',
  amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
  paid_at TIMESTAMPTZ,
  payment_method TEXT,
  payment_reference TEXT,
  notes TEXT,

  recorded_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT owner_payouts_period_chk CHECK (period_end >= period_start),
  CONSTRAINT owner_payouts_status_chk
    CHECK (status IN ('pending', 'partially_paid', 'paid', 'cancelled')),
  CONSTRAINT owner_payouts_payment_method_chk
    CHECK (payment_method IS NULL
           OR payment_method IN ('bank_transfer', 'cash', 'cheque', 'stripe', 'other'))
);

-- Block exact-match overlapping periods (excluding cancelled).
-- Intersecting (non-identical) overlap is enforced at app level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_payouts_no_overlap
  ON public.owner_payouts(owner_id, period_start, period_end)
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_owner_payouts_tenant_id
  ON public.owner_payouts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_owner_payouts_owner_status
  ON public.owner_payouts(owner_id, status);

ALTER TABLE public.owner_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant users view own payouts" ON public.owner_payouts;
CREATE POLICY "Tenant users view own payouts"
  ON public.owner_payouts FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users insert payouts" ON public.owner_payouts;
CREATE POLICY "Tenant users insert payouts"
  ON public.owner_payouts FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users update payouts" ON public.owner_payouts;
CREATE POLICY "Tenant users update payouts"
  ON public.owner_payouts FOR UPDATE
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users delete payouts" ON public.owner_payouts;
CREATE POLICY "Tenant users delete payouts"
  ON public.owner_payouts FOR DELETE
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP TRIGGER IF EXISTS set_owner_payouts_updated_at ON public.owner_payouts;
CREATE TRIGGER set_owner_payouts_updated_at
  BEFORE UPDATE ON public.owner_payouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================
-- 4. owner_payout_lines (per-rental snapshot)
-- ============================================
CREATE TABLE IF NOT EXISTS public.owner_payout_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id UUID NOT NULL REFERENCES public.owner_payouts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  rental_id UUID REFERENCES public.rentals(id) ON DELETE SET NULL,

  vehicle_reg TEXT NOT NULL,
  paid_revenue NUMERIC(12, 2) NOT NULL,
  commission_type TEXT NOT NULL,
  commission_value NUMERIC(12, 2) NOT NULL,
  commission_amount NUMERIC(12, 2) NOT NULL,
  net_to_owner NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT owner_payout_lines_commission_type_chk
    CHECK (commission_type IN ('percentage', 'flat_fee'))
);

CREATE INDEX IF NOT EXISTS idx_owner_payout_lines_payout_id
  ON public.owner_payout_lines(payout_id);
CREATE INDEX IF NOT EXISTS idx_owner_payout_lines_tenant_id
  ON public.owner_payout_lines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_owner_payout_lines_vehicle_id
  ON public.owner_payout_lines(vehicle_id);

ALTER TABLE public.owner_payout_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant users view own payout lines" ON public.owner_payout_lines;
CREATE POLICY "Tenant users view own payout lines"
  ON public.owner_payout_lines FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users insert payout lines" ON public.owner_payout_lines;
CREATE POLICY "Tenant users insert payout lines"
  ON public.owner_payout_lines FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users update payout lines" ON public.owner_payout_lines;
CREATE POLICY "Tenant users update payout lines"
  ON public.owner_payout_lines FOR UPDATE
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users delete payout lines" ON public.owner_payout_lines;
CREATE POLICY "Tenant users delete payout lines"
  ON public.owner_payout_lines FOR DELETE
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- ============================================
-- 5. view_owner_revenue
-- Per-payment row for vehicles assigned to a third-party owner,
-- only counting payments that were verified (approved or auto_approved).
-- Filters out revenue dated before the vehicle was assigned to the owner.
-- ============================================
CREATE OR REPLACE VIEW public.view_owner_revenue AS
SELECT
  v.tenant_id,
  v.owner_id,
  v.id              AS vehicle_id,
  v.reg             AS vehicle_reg,
  le.rental_id,
  p.id              AS payment_id,
  p.payment_date::date AS revenue_date,
  pa.amount_applied AS paid_amount
FROM public.payment_applications pa
JOIN public.payments p          ON p.id = pa.payment_id
JOIN public.ledger_entries le   ON le.id = pa.charge_entry_id
JOIN public.vehicles v          ON v.id = le.vehicle_id
WHERE le.type = 'Charge'
  AND le.category IN ('Rental', 'InitialFee')
  AND v.owner_id IS NOT NULL
  AND COALESCE(p.verification_status, '') IN ('approved', 'auto_approved')
  AND (
    v.ownership_assigned_at IS NULL
    OR p.payment_date >= v.ownership_assigned_at::date
  );

-- ============================================
-- 6. calculate_owner_owed(owner_id, from_date, to_date)
-- Returns per-vehicle aggregated revenue + commission for a date range,
-- applying the per-vehicle override or owner default.
-- For flat_fee:
--   - per_month: charge value * months in range (rounded up to whole months)
--   - per_rental: charge value * distinct rentals with paid revenue in range
-- ============================================
CREATE OR REPLACE FUNCTION public.calculate_owner_owed(
  p_owner_id UUID,
  p_from_date DATE,
  p_to_date DATE
)
RETURNS TABLE (
  vehicle_id UUID,
  vehicle_reg TEXT,
  rental_count INTEGER,
  paid_revenue NUMERIC,
  commission_type TEXT,
  commission_value NUMERIC,
  flat_fee_period TEXT,
  commission_amount NUMERIC,
  net_to_owner NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_months NUMERIC;
BEGIN
  -- Number of months in range, rounded up, minimum 1.
  v_months := GREATEST(1, CEIL((p_to_date - p_from_date + 1)::numeric / 30.0));

  RETURN QUERY
  WITH owner_cfg AS (
    SELECT o.commission_type, o.commission_value, o.flat_fee_period
    FROM public.vehicle_owners o
    WHERE o.id = p_owner_id
  ),
  vehicle_revenue AS (
    SELECT
      v.id AS v_id,
      v.reg AS v_reg,
      COALESCE(v.commission_type_override, oc.commission_type) AS c_type,
      COALESCE(v.commission_value_override, oc.commission_value) AS c_value,
      COALESCE(v.flat_fee_period_override, oc.flat_fee_period) AS c_period,
      COALESCE(SUM(vor.paid_amount), 0) AS revenue,
      COUNT(DISTINCT vor.rental_id) FILTER (WHERE vor.rental_id IS NOT NULL) AS rentals
    FROM public.vehicles v
    CROSS JOIN owner_cfg oc
    LEFT JOIN public.view_owner_revenue vor
      ON vor.vehicle_id = v.id
     AND vor.revenue_date BETWEEN p_from_date AND p_to_date
    WHERE v.owner_id = p_owner_id
    GROUP BY v.id, v.reg, oc.commission_type, oc.commission_value, oc.flat_fee_period,
             v.commission_type_override, v.commission_value_override, v.flat_fee_period_override
  ),
  computed AS (
    SELECT
      vr.v_id,
      vr.v_reg,
      vr.rentals::INTEGER AS rentals,
      ROUND(vr.revenue, 2) AS revenue,
      vr.c_type,
      vr.c_value,
      vr.c_period,
      CASE
        WHEN vr.c_type = 'percentage'
          THEN ROUND(vr.revenue * vr.c_value / 100.0, 2)
        WHEN vr.c_type = 'flat_fee' AND vr.c_period = 'per_rental'
          THEN ROUND(vr.c_value * vr.rentals, 2)
        WHEN vr.c_type = 'flat_fee' AND vr.c_period = 'per_month'
          THEN ROUND(vr.c_value * v_months, 2)
        ELSE 0
      END AS commission
    FROM vehicle_revenue vr
  )
  SELECT
    c.v_id,
    c.v_reg,
    c.rentals,
    c.revenue,
    c.c_type,
    c.c_value,
    c.c_period,
    c.commission,
    c.revenue - c.commission
  FROM computed c;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_owner_owed(UUID, DATE, DATE) TO authenticated;

-- ============================================
-- 7. Documentation
-- ============================================
COMMENT ON TABLE public.vehicle_owners IS
  'Third-party vehicle owners whose cars the tenant manages on consignment.';
COMMENT ON TABLE public.owner_payouts IS
  'Manual payouts to vehicle owners. Header table; line items in owner_payout_lines.';
COMMENT ON TABLE public.owner_payout_lines IS
  'Immutable per-rental snapshot of revenue and commission for a payout.';
COMMENT ON VIEW public.view_owner_revenue IS
  'Paid (verified) rental revenue attributed to vehicles with a third-party owner. Excludes revenue dated before vehicles.ownership_assigned_at.';
COMMENT ON FUNCTION public.calculate_owner_owed(UUID, DATE, DATE) IS
  'Per-vehicle aggregated paid revenue + computed commission for an owner over a date range, honouring per-vehicle overrides.';
