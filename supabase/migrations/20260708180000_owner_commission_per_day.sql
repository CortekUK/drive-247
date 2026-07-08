-- ============================================================================
-- Owner payouts: per-day flat-fee commission
-- ----------------------------------------------------------------------------
-- GMT charges vehicle owners a flat fee for every DAY the car was rented, not
-- per rental ("$13.95 for every day the car was out"). Adds 'per_day' as a
-- flat_fee_period option:
--   commission = fee × rented days overlapping the payout window
-- Gross revenue stays CASH-BASIS (payments actually collected) — deliberately:
-- an accrual gross would owe owners money the operator never collected when a
-- renter misses a payment. When payments are current the result equals the
-- operator's own day-based math.
-- Rented days per vehicle = sum over possession-state rentals (Active /
-- Completed / Closed) of the day-overlap between [start_date, end_date] and
-- the payout window, clipped to ownership_assigned_at.
-- Return shape of calculate_owner_owed is UNCHANGED (no caller migration).
-- ============================================================================

-- 1. Allow 'per_day' in both CHECK constraints
ALTER TABLE public.vehicle_owners DROP CONSTRAINT IF EXISTS vehicle_owners_flat_period_chk;
ALTER TABLE public.vehicle_owners ADD CONSTRAINT vehicle_owners_flat_period_chk
  CHECK (
    commission_type = 'percentage'
    OR flat_fee_period = ANY (ARRAY['per_rental'::text, 'per_month'::text, 'per_day'::text])
  );

ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_commission_override_chk;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_commission_override_chk
  CHECK (
    (commission_type_override IS NULL OR commission_type_override = ANY (ARRAY['percentage'::text, 'flat_fee'::text]))
    AND (flat_fee_period_override IS NULL OR flat_fee_period_override = ANY (ARRAY['per_rental'::text, 'per_month'::text, 'per_day'::text]))
    AND (commission_value_override IS NULL OR commission_value_override >= (0)::numeric)
  );

-- 2. calculate_owner_owed: add the per_day commission branch
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
  -- Days each vehicle was rented within the window (per_day commission input):
  -- DISTINCT calendar days across all possession-state rentals, clipped to the
  -- window and to the day the vehicle was assigned to the owner. Distinct-day
  -- counting (date spine) rather than summing per-rental overlaps: overlapping
  -- historical rentals and same-day turnarounds (car returned and re-rented on
  -- the same date) must count that day ONCE, not once per rental. A Pending
  -- (unstarted) or Cancelled rental never had the car out.
  rented_days AS (
    SELECT
      s.rd_vehicle_id,
      COUNT(DISTINCT s.rented_day)::numeric AS days_rented
    FROM (
      SELECT
        r.vehicle_id AS rd_vehicle_id,
        generate_series(
          GREATEST(r.start_date, p_from_date, COALESCE(v2.ownership_assigned_at::date, r.start_date)),
          LEAST(COALESCE(r.end_date, p_to_date), p_to_date),
          interval '1 day'
        )::date AS rented_day
      FROM public.rentals r
      JOIN public.vehicles v2 ON v2.id = r.vehicle_id
      WHERE v2.owner_id = p_owner_id
        AND r.status IN ('Active', 'Completed', 'Closed')
        AND r.start_date <= p_to_date
        AND COALESCE(r.end_date, p_to_date) >= p_from_date
    ) s
    GROUP BY s.rd_vehicle_id
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
      COUNT(DISTINCT vor.rental_id) FILTER (WHERE vor.rental_id IS NOT NULL) AS rentals,
      COALESCE(MAX(rd.days_rented), 0) AS days_rented
    FROM public.vehicles v
    CROSS JOIN owner_cfg oc
    LEFT JOIN public.view_owner_revenue vor
      ON vor.vehicle_id = v.id
     AND vor.revenue_date BETWEEN p_from_date AND p_to_date
    LEFT JOIN already_paid ap ON ap.vehicle_id = v.id
    LEFT JOIN rented_days rd ON rd.rd_vehicle_id = v.id
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
        WHEN vr.c_type = 'flat_fee' AND vr.c_period = 'per_day'
          THEN ROUND(vr.c_value * vr.days_rented, 2)
        ELSE 0
      END AS commission
    FROM vehicle_revenue vr
    -- Hide vehicles that have already been fully paid out for this period.
    -- per_day is ACCRUAL-based (days the car was out), so a per_day vehicle
    -- must surface even in a window that collected no cash — otherwise weekly
    -- payouts on prepaid rentals silently skip the operator's commission for
    -- every week that lacks a payment date. Net goes negative in those weeks
    -- (owner owes operator); downstream already blocks paying negative nets
    -- and carries them forward.
    WHERE vr.revenue > 0
       OR (vr.c_type = 'flat_fee' AND vr.c_period = 'per_day' AND vr.days_rented > 0)
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
  'Per-vehicle aggregated paid revenue + computed commission for an owner over a date range. Honours per-vehicle overrides, excludes revenue already snapshotted in non-cancelled overlapping payouts, and supports flat-fee per_rental / per_month / per_day (per_day = fee x rented days overlapping the window; gross stays cash-basis).';
