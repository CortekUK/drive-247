-- ============================================
-- Owner payouts: per-vehicle overlap logic
-- Allow multiple payouts in the same period for the same owner as long as
-- they cover different vehicles. The preview now subtracts revenue that's
-- already been snapshotted in non-cancelled payouts for any overlapping period.
-- ============================================

-- 1. Drop the strict period-uniqueness index. Per-vehicle protection now
-- happens inside calculate_owner_owed (vehicles already covered are excluded).
DROP INDEX IF EXISTS public.idx_owner_payouts_no_overlap;

-- 2. Replace calculate_owner_owed: subtract revenue already snapshotted
-- in non-cancelled payouts whose period intersects the requested range.
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
  v_months := GREATEST(1, CEIL((p_to_date - p_from_date + 1)::numeric / 30.0));

  RETURN QUERY
  WITH owner_cfg AS (
    SELECT o.commission_type, o.commission_value, o.flat_fee_period
    FROM public.vehicle_owners o
    WHERE o.id = p_owner_id
  ),
  -- Sum of paid_revenue already snapshotted per vehicle in non-cancelled
  -- payouts whose period intersects the requested range.
  already_paid AS (
    SELECT
      opl.vehicle_id,
      COALESCE(SUM(opl.paid_revenue), 0) AS amount_covered
    FROM public.owner_payout_lines opl
    JOIN public.owner_payouts op ON op.id = opl.payout_id
    WHERE op.owner_id = p_owner_id
      AND op.status <> 'cancelled'
      AND op.period_start <= p_to_date
      AND op.period_end >= p_from_date
    GROUP BY opl.vehicle_id
  ),
  vehicle_revenue AS (
    SELECT
      v.id AS v_id,
      v.reg AS v_reg,
      COALESCE(v.commission_type_override, oc.commission_type) AS c_type,
      COALESCE(v.commission_value_override, oc.commission_value) AS c_value,
      COALESCE(v.flat_fee_period_override, oc.flat_fee_period) AS c_period,
      GREATEST(
        0,
        COALESCE(SUM(vor.paid_amount), 0) - COALESCE(MAX(ap.amount_covered), 0)
      ) AS revenue,
      COUNT(DISTINCT vor.rental_id) FILTER (WHERE vor.rental_id IS NOT NULL) AS rentals
    FROM public.vehicles v
    CROSS JOIN owner_cfg oc
    LEFT JOIN public.view_owner_revenue vor
      ON vor.vehicle_id = v.id
     AND vor.revenue_date BETWEEN p_from_date AND p_to_date
    LEFT JOIN already_paid ap ON ap.vehicle_id = v.id
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
    -- Hide vehicles that have already been fully paid out for this period.
    WHERE vr.revenue > 0
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

COMMENT ON FUNCTION public.calculate_owner_owed(UUID, DATE, DATE) IS
  'Per-vehicle aggregated paid revenue + computed commission for an owner over a date range. Honours per-vehicle overrides AND excludes revenue already snapshotted in non-cancelled payouts for an overlapping period (so the preview only shows what is still owed).';
