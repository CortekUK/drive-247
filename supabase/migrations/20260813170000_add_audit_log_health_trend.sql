-- Build a genuine daily Health Score history from audit logs. The feature was
-- introduced with only one stored evaluation day, which left the line chart
-- with isolated dots. This read-only reconstruction applies the current
-- Health Score settings at each historical UTC day without creating snapshots,
-- incidents, outbox rows, or synthetic data.

CREATE OR REPLACE FUNCTION public.get_health_score_dashboard(p_history_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH settings AS (
    SELECT *
    FROM public.health_score_settings
    WHERE singleton = true
  ), history AS (
    SELECT LEAST(GREATEST(COALESCE(p_history_days, 30), 1), 365) AS day_count
  ), reference AS (
    SELECT COALESCE(
      (
        SELECT r.evaluated_at
        FROM public.health_score_runs r
        WHERE r.status = 'succeeded'
        ORDER BY r.started_at DESC
        LIMIT 1
      ),
      now()
    ) AS anchor_at
  ), anchors AS (
    SELECT
      ((reference.anchor_at AT TIME ZONE 'UTC')::date - series.day_offset)::date AS day,
      CASE
        WHEN series.day_offset = 0 THEN reference.anchor_at
        ELSE (
          ((reference.anchor_at AT TIME ZONE 'UTC')::date - series.day_offset + 1)::timestamp
          AT TIME ZONE 'UTC'
        )
      END AS anchor_at
    FROM reference
    CROSS JOIN history
    CROSS JOIN LATERAL generate_series(0, history.day_count - 1) AS series(day_offset)
  ), latest AS (
    SELECT * FROM public.v_latest_tenant_health
  ), eligible_tenants AS (
    SELECT t.id, t.created_at
    FROM public.tenants t
    CROSS JOIN settings cfg
    LEFT JOIN LATERAL (
      SELECT subscription.status
      FROM public.tenant_subscriptions subscription
      WHERE subscription.tenant_id = t.id
      ORDER BY subscription.created_at DESC
      LIMIT 1
    ) latest_subscription ON true
    WHERE lower(COALESCE(t.status, '')) = 'active'
      AND (cfg.include_test_tenants OR COALESCE(t.tenant_type, 'production') <> 'test')
      AND (
        latest_subscription.status IS NULL
        OR latest_subscription.status IN ('active', 'trialing', 'past_due')
      )
  ), historical_activity AS (
    SELECT
      anchor.day,
      anchor.anchor_at,
      tenant.id AS tenant_id,
      tenant.created_at AS tenant_created_at,
      count(audit.id) FILTER (
        WHERE audit.activity_source = 'tenant_user'
          AND audit.action <> 'login_failed'
          AND audit.created_at >= anchor.anchor_at - make_interval(days => cfg.period_days)
          AND audit.created_at < anchor.anchor_at
      )::integer AS current_count,
      count(audit.id) FILTER (
        WHERE audit.activity_source = 'tenant_user'
          AND audit.action <> 'login_failed'
          AND audit.created_at >= anchor.anchor_at - make_interval(days => cfg.period_days * 2)
          AND audit.created_at < anchor.anchor_at - make_interval(days => cfg.period_days)
      )::integer AS baseline_count,
      count(audit.id) FILTER (
        WHERE audit.activity_source = 'unknown'
          AND audit.created_at >= anchor.anchor_at - make_interval(days => cfg.period_days * 2)
          AND audit.created_at < anchor.anchor_at
      )::integer AS unattributed_count,
      cfg.period_days,
      cfg.new_tenant_grace_days,
      cfg.minimum_baseline_events,
      cfg.threshold_percent
    FROM anchors anchor
    CROSS JOIN settings cfg
    JOIN eligible_tenants tenant ON tenant.created_at < anchor.anchor_at
    LEFT JOIN public.audit_logs audit
      ON audit.tenant_id = tenant.id
     AND audit.created_at >= anchor.anchor_at - make_interval(days => cfg.period_days * 2)
     AND audit.created_at < anchor.anchor_at
    GROUP BY
      anchor.day,
      anchor.anchor_at,
      tenant.id,
      tenant.created_at,
      cfg.period_days,
      cfg.new_tenant_grace_days,
      cfg.minimum_baseline_events,
      cfg.threshold_percent
  ), historical_scored AS (
    SELECT
      activity.*,
      COALESCE(activity.tenant_created_at, '-infinity'::timestamptz) <=
        activity.anchor_at - make_interval(
          days => GREATEST(activity.period_days * 2, activity.new_tenant_grace_days)
        ) AS has_complete_history,
      CASE
        WHEN COALESCE(activity.tenant_created_at, '-infinity'::timestamptz) >
          activity.anchor_at - make_interval(
            days => GREATEST(activity.period_days * 2, activity.new_tenant_grace_days)
          ) THEN NULL
        WHEN activity.baseline_count = 0 AND activity.current_count > 0 THEN 100
        WHEN activity.baseline_count = 0 AND activity.current_count = 0 THEN 0
        ELSE LEAST(
          100,
          round(
            activity.current_count::numeric * 100
            / NULLIF(activity.baseline_count, 0)
          )::integer
        )
      END AS score
    FROM historical_activity activity
  ), historical_statuses AS (
    SELECT
      scored.day,
      CASE
        WHEN NOT scored.has_complete_history THEN 'insufficient_data'
        WHEN scored.current_count = 0
          AND scored.baseline_count = 0
          AND scored.unattributed_count > 0 THEN 'data_issue'
        WHEN scored.current_count = 0 THEN 'dormant'
        WHEN scored.baseline_count < scored.minimum_baseline_events
          AND scored.score <= scored.threshold_percent THEN 'watch'
        WHEN scored.score <= scored.threshold_percent THEN 'at_risk'
        WHEN scored.score <= scored.threshold_percent + 20 THEN 'watch'
        ELSE 'healthy'
      END AS status
    FROM historical_scored scored
  ), trend AS (
    SELECT
      anchor.day,
      count(statuses.status) FILTER (WHERE statuses.status = 'healthy') AS healthy,
      count(statuses.status) FILTER (WHERE statuses.status IN ('watch', 'recovering')) AS watch,
      count(statuses.status) FILTER (WHERE statuses.status IN ('at_risk', 'dormant')) AS at_risk,
      count(statuses.status) FILTER (WHERE statuses.status IN ('insufficient_data', 'data_issue')) AS unavailable
    FROM anchors anchor
    LEFT JOIN historical_statuses statuses ON statuses.day = anchor.day
    GROUP BY anchor.day
    ORDER BY anchor.day
  ), last_run AS (
    SELECT id, evaluated_at, completed_at, status, tenant_count, at_risk_count, new_incident_count, error_message
    FROM public.health_score_runs
    ORDER BY started_at DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'monitored', (SELECT count(*) FROM latest),
      'at_risk', (SELECT count(*) FROM latest WHERE status IN ('at_risk', 'dormant')),
      'new_at_risk', (
        SELECT count(*) FROM latest
        WHERE status IN ('at_risk', 'dormant')
          AND risk_since >= now() - interval '24 hours'
      ),
      'watch', (SELECT count(*) FROM latest WHERE status IN ('watch', 'recovering')),
      'insufficient', (
        SELECT count(*) FROM latest WHERE status IN ('insufficient_data', 'data_issue')
      ),
      'median_score', COALESCE((
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY health_score)
        FROM latest
        WHERE health_score IS NOT NULL
          AND status NOT IN ('insufficient_data', 'data_issue')
      ), 0)
    ),
    'trend', COALESCE(
      (SELECT jsonb_agg(to_jsonb(trend) ORDER BY day) FROM trend),
      '[]'::jsonb
    ),
    'last_run', (SELECT to_jsonb(last_run) FROM last_run)
  )
  WHERE auth.role() = 'service_role' OR public.is_super_admin();
$$;

REVOKE ALL ON FUNCTION public.get_health_score_dashboard(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_health_score_dashboard(integer) TO authenticated, service_role;
