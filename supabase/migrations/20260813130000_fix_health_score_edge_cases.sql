-- Health Score edge-case hardening
--
-- 1. A score is capped at 100. For thresholds above 90, recovery at
--    threshold+10 must therefore be inclusive or recovery is impossible.
-- 2. The settings preview must treat unattributed-only audit activity exactly
--    like the evaluator: Data Issue, not Dormant and not alertable.

DO $migration$
DECLARE
  v_definition text;
  v_old text := 'v_snapshot.health_score > LEAST(100, v_settings.threshold_percent + 10)';
  v_new text := 'v_snapshot.health_score >= LEAST(100, v_settings.threshold_percent + 10)';
BEGIN
  SELECT pg_get_functiondef(
    'public.evaluate_tenant_health(text,boolean,timestamp with time zone)'::regprocedure
  ) INTO v_definition;

  IF position(v_old IN v_definition) > 0 THEN
    EXECUTE replace(v_definition, v_old, v_new);
  ELSIF position(v_new IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not locate the Health Score recovery boundary';
  END IF;
END
$migration$;

CREATE OR REPLACE FUNCTION public.preview_tenant_health_settings(
  p_period_days integer,
  p_threshold_percent integer,
  p_minimum_baseline_events integer,
  p_new_tenant_grace_days integer,
  p_include_test_tenants boolean DEFAULT false,
  p_evaluated_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH eligible AS (
    SELECT t.id, t.created_at
    FROM public.tenants t
    LEFT JOIN LATERAL (
      SELECT s.status FROM public.tenant_subscriptions s
      WHERE s.tenant_id = t.id ORDER BY s.created_at DESC LIMIT 1
    ) sub ON true
    WHERE lower(COALESCE(t.status, '')) = 'active'
      AND (p_include_test_tenants OR COALESCE(t.tenant_type, 'production') <> 'test')
      AND (sub.status IS NULL OR sub.status IN ('active', 'trialing', 'past_due'))
  ), counts AS (
    SELECT e.id, e.created_at,
      COUNT(al.id) FILTER (
        WHERE al.activity_source = 'tenant_user'
          AND al.action <> 'login_failed'
          AND al.created_at >= p_evaluated_at - make_interval(days => p_period_days)
      )::integer AS current_count,
      COUNT(al.id) FILTER (
        WHERE al.activity_source = 'tenant_user'
          AND al.action <> 'login_failed'
          AND al.created_at >= p_evaluated_at - make_interval(days => p_period_days * 2)
          AND al.created_at < p_evaluated_at - make_interval(days => p_period_days)
      )::integer AS baseline_count,
      COUNT(al.id) FILTER (
        WHERE al.activity_source = 'unknown'
          AND al.created_at >= p_evaluated_at - make_interval(days => p_period_days * 2)
          AND al.created_at < p_evaluated_at
      )::integer AS unattributed_count
    FROM eligible e
    LEFT JOIN public.audit_logs al
      ON al.tenant_id = e.id
     AND al.created_at >= p_evaluated_at - make_interval(days => p_period_days * 2)
     AND al.created_at < p_evaluated_at
    GROUP BY e.id, e.created_at
  ), scored AS (
    SELECT *,
      COALESCE(created_at, '-infinity'::timestamptz) <=
        p_evaluated_at - make_interval(days => GREATEST(p_period_days * 2, p_new_tenant_grace_days)) AS complete,
      CASE
        WHEN baseline_count = 0 AND current_count > 0 THEN 100
        WHEN baseline_count = 0 THEN 0
        ELSE LEAST(100, round(current_count::numeric * 100 / baseline_count)::integer)
      END AS score
    FROM counts
  )
  SELECT jsonb_build_object(
    'monitored', count(*),
    'insufficient_data', count(*) FILTER (WHERE NOT complete),
    'data_issue', count(*) FILTER (
      WHERE complete AND current_count = 0 AND baseline_count = 0 AND unattributed_count > 0
    ),
    'dormant', count(*) FILTER (
      WHERE complete AND current_count = 0
        AND NOT (baseline_count = 0 AND unattributed_count > 0)
    ),
    'at_risk', count(*) FILTER (
      WHERE complete AND current_count > 0
        AND baseline_count >= p_minimum_baseline_events
        AND score <= p_threshold_percent
    ),
    'would_alert', count(*) FILTER (
      WHERE complete AND (
        (current_count = 0 AND NOT (baseline_count = 0 AND unattributed_count > 0)) OR
        (current_count > 0 AND baseline_count >= p_minimum_baseline_events AND score <= p_threshold_percent)
      )
    )
  )
  FROM scored
  WHERE auth.role() = 'service_role' OR public.is_super_admin();
$$;

REVOKE ALL ON FUNCTION public.preview_tenant_health_settings(integer, integer, integer, integer, boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_tenant_health_settings(integer, integer, integer, integer, boolean, timestamptz) TO authenticated, service_role;
