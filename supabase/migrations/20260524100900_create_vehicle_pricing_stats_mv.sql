-- Revenue Optimiser — vehicle_pricing_stats MATERIALIZED VIEW (Spec §9.2).
--
-- Single source of truth for all per-vehicle metrics that feed the elasticity engine.
-- Refreshed hourly via pg_cron + edge function (next migration schedules the cron).
--
-- Implementation differs from spec illustrative SQL in two ways (per plan deviations):
--   1. Revenue aggregated from `ledger_entries` SUM (type='Charge') instead of the
--      non-existent `rentals.total_price` column.
--   2. `active_enquiries_14d` and `enquiry_conversion_90d` UNION over both the legacy
--      `enquiries` table AND the modern `leads` table (filtered by stage), so the
--      Lead Management module's data also contributes to pricing signals.
--
-- Uses CTEs per source table for one pass each, then LEFT JOINs onto vehicles.
-- The UNIQUE INDEX on vehicle_id enables `REFRESH MATERIALIZED VIEW CONCURRENTLY`.

CREATE MATERIALIZED VIEW public.vehicle_pricing_stats AS
WITH
  rentals_agg AS (
    SELECT
      r.vehicle_id,
      COUNT(*) FILTER (
        WHERE r.status IN ('Active','Closed')
        AND r.end_date >= (now()::date - INTERVAL '30 days')
        AND r.start_date <= now()::date
      ) AS bookings_30d,
      COUNT(*) FILTER (
        WHERE r.status IN ('Active','Closed')
        AND r.end_date >= (now()::date - INTERVAL '90 days')
        AND r.start_date <= now()::date
      ) AS bookings_90d,
      COALESCE(SUM(
        GREATEST(0,
          (LEAST(now()::date, r.end_date::date)
           - GREATEST((now()::date - INTERVAL '30 days')::date, r.start_date::date))::int + 1
        )
      ) FILTER (
        WHERE r.status IN ('Active','Closed')
        AND r.end_date >= (now()::date - INTERVAL '30 days')
        AND r.start_date <= now()::date
      ), 0)::int AS booked_days_30d,
      MAX(r.end_date::date) FILTER (
        WHERE r.status IN ('Active','Closed')
        AND r.end_date <= now()::date
      ) AS last_end_date,
      COUNT(DISTINCT r.start_date::date) FILTER (
        WHERE r.status IN ('Active','Closed','Pending')
        AND r.start_date::date BETWEEN now()::date AND (now()::date + INTERVAL '90 days')::date
      ) AS upcoming_booking_days_90d
    FROM public.rentals r
    WHERE r.vehicle_id IS NOT NULL
    GROUP BY r.vehicle_id
  ),
  ledger_agg AS (
    SELECT
      le.vehicle_id,
      COALESCE(SUM(le.amount) FILTER (WHERE le.entry_date >= (now()::date - INTERVAL '30 days')), 0) AS revenue_30d,
      COALESCE(SUM(le.amount) FILTER (WHERE le.entry_date >= (now()::date - INTERVAL '90 days')), 0) AS revenue_90d
    FROM public.ledger_entries le
    WHERE le.type = 'Charge'
    AND le.vehicle_id IS NOT NULL
    GROUP BY le.vehicle_id
  ),
  enquiry_agg AS (
    SELECT
      vehicle_id,
      COUNT(*) FILTER (WHERE recent_14d) AS active_enquiries_14d,
      COUNT(*) AS total_90d,
      COUNT(*) FILTER (WHERE converted) AS converted_90d
    FROM (
      -- legacy enquiries source
      SELECT
        e.vehicle_id,
        (e.created_at >= now() - INTERVAL '14 days'
         AND e.status IN ('new','contacted')) AS recent_14d,
        (e.customer_id IS NOT NULL) AS converted
      FROM public.enquiries e
      WHERE e.created_at >= now() - INTERVAL '90 days'
      AND e.vehicle_id IS NOT NULL

      UNION ALL

      -- modern leads source
      SELECT
        l.vehicle_id,
        (l.created_at >= now() - INTERVAL '14 days'
         AND l.stage IN ('new','contacted','vehicle_offered')) AS recent_14d,
        (l.converted_to_rental_id IS NOT NULL) AS converted
      FROM public.leads l
      WHERE l.created_at >= now() - INTERVAL '90 days'
      AND l.vehicle_id IS NOT NULL
    ) combined
    GROUP BY vehicle_id
  )
SELECT
  v.id AS vehicle_id,
  v.tenant_id,
  v.category,
  v.make,
  v.model,
  v.daily_rent,
  v.weekly_rent,
  v.monthly_rent,
  v.cost_floor_daily,
  v.cost_floor_weekly,
  v.cost_floor_monthly,

  COALESCE(ra.bookings_30d, 0)::int AS bookings_30d,
  COALESCE(ra.bookings_90d, 0)::int AS bookings_90d,
  COALESCE(la.revenue_30d, 0)::numeric(12,2) AS revenue_30d,
  COALESCE(la.revenue_90d, 0)::numeric(12,2) AS revenue_90d,
  COALESCE(ra.booked_days_30d, 0)::int AS booked_days_30d,

  -- utilization% as 0..100
  CASE
    WHEN COALESCE(ra.booked_days_30d, 0) = 0 THEN 0
    ELSE LEAST(100.0, ROUND(100.0 * ra.booked_days_30d / 30.0, 2))
  END::numeric(5,2) AS utilization_30d,

  -- days since the vehicle was last rented out (NULL = never rented)
  CASE
    WHEN ra.last_end_date IS NULL THEN NULL
    ELSE GREATEST(0, (now()::date - ra.last_end_date))::int
  END AS idle_days,

  COALESCE(ea.active_enquiries_14d, 0)::int AS active_enquiries_14d,
  CASE
    WHEN COALESCE(ea.total_90d, 0) = 0 THEN NULL
    ELSE ROUND(100.0 * ea.converted_90d::numeric / ea.total_90d::numeric, 2)
  END::numeric(5,2) AS enquiry_conversion_90d,

  COALESCE(ra.upcoming_booking_days_90d, 0)::int AS upcoming_booking_days_90d,

  now() AS computed_at
FROM public.vehicles v
LEFT JOIN rentals_agg ra ON ra.vehicle_id = v.id
LEFT JOIN ledger_agg la ON la.vehicle_id = v.id
LEFT JOIN enquiry_agg ea ON ea.vehicle_id = v.id
WHERE v.is_disposed IS NOT TRUE;

-- UNIQUE index required so `REFRESH MATERIALIZED VIEW CONCURRENTLY` works (no read blocking).
CREATE UNIQUE INDEX vehicle_pricing_stats_vehicle_idx
  ON public.vehicle_pricing_stats(vehicle_id);

CREATE INDEX vehicle_pricing_stats_tenant_idx
  ON public.vehicle_pricing_stats(tenant_id);

CREATE INDEX vehicle_pricing_stats_tenant_category_idx
  ON public.vehicle_pricing_stats(tenant_id, category)
  WHERE category IS NOT NULL;

-- Note: materialized views don't support RLS directly. Read access for tenant staff
-- is enforced by the edge functions that query it (filter WHERE tenant_id = ...).
-- For super-admin direct queries via mcp__supabase__execute_sql, full access via service_role.
GRANT SELECT ON public.vehicle_pricing_stats TO authenticated;
GRANT SELECT ON public.vehicle_pricing_stats TO service_role;

COMMENT ON MATERIALIZED VIEW public.vehicle_pricing_stats IS 'Per-vehicle pricing/demand/supply metrics. Refreshed hourly via pg_cron. Spec §9.2.';
