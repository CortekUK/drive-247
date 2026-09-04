-- Tenant Health Score
--
-- Retention signal built from tenant-user audit activity. The evaluator compares
-- one rolling period with the immediately preceding period. All calculations,
-- incident transitions and notification-outbox writes happen in one database
-- transaction so a browser refresh or overlapping cron run cannot double-alert.

-- ---------------------------------------------------------------------------
-- 1. Make audit-event provenance explicit. Existing rows are classified from
--    their actor; future rows are classified by a trigger. Only tenant_user
--    events count toward health.
-- ---------------------------------------------------------------------------

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS activity_source text NOT NULL DEFAULT 'unknown';

ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_activity_source_check;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_activity_source_check
  CHECK (activity_source IN ('tenant_user', 'super_admin', 'system', 'public', 'unknown'));

CREATE OR REPLACE FUNCTION public.classify_audit_log_activity_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.app_users%ROWTYPE;
BEGIN
  -- Failed credentials are not product usage and may not belong to any account.
  IF NEW.action = 'login_failed' THEN
    NEW.activity_source := 'public';
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_super_admin_action, false) THEN
    NEW.activity_source := 'super_admin';
    RETURN NEW;
  END IF;

  IF NEW.actor_id IS NULL THEN
    -- This deliberately groups anonymous/public and background writes together:
    -- neither category is tenant-operator engagement, so neither is scored.
    IF NEW.activity_source NOT IN ('public', 'system') THEN
      NEW.activity_source := 'system';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_actor FROM public.app_users WHERE id = NEW.actor_id;
  IF NOT FOUND THEN
    NEW.activity_source := 'unknown';
  ELSIF COALESCE(v_actor.is_super_admin, false) THEN
    NEW.activity_source := 'super_admin';
  ELSIF NEW.tenant_id IS NOT NULL AND v_actor.tenant_id = NEW.tenant_id THEN
    NEW.activity_source := 'tenant_user';
  ELSE
    NEW.activity_source := 'unknown';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS classify_audit_log_activity_source ON public.audit_logs;
CREATE TRIGGER classify_audit_log_activity_source
  BEFORE INSERT OR UPDATE OF actor_id, tenant_id, action, is_super_admin_action, activity_source
  ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.classify_audit_log_activity_source();

UPDATE public.audit_logs al
SET activity_source = CASE
  WHEN al.action = 'login_failed' THEN 'public'
  WHEN COALESCE(al.is_super_admin_action, false) THEN 'super_admin'
  WHEN al.actor_id IS NULL THEN 'system'
  WHEN EXISTS (
    SELECT 1 FROM public.app_users au
    WHERE au.id = al.actor_id AND COALESCE(au.is_super_admin, false)
  ) THEN 'super_admin'
  WHEN al.tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.app_users au
    WHERE au.id = al.actor_id AND au.tenant_id = al.tenant_id
  ) THEN 'tenant_user'
  ELSE 'unknown'
END;

CREATE INDEX IF NOT EXISTS idx_audit_logs_health_activity
  ON public.audit_logs (tenant_id, created_at)
  WHERE activity_source = 'tenant_user' AND action <> 'login_failed';

-- ---------------------------------------------------------------------------
-- 2. Configuration and operational data.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.health_score_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  enabled boolean NOT NULL DEFAULT true,
  period_days integer NOT NULL DEFAULT 30 CHECK (period_days BETWEEN 1 AND 365),
  threshold_percent integer NOT NULL DEFAULT 50 CHECK (threshold_percent BETWEEN 1 AND 99),
  minimum_baseline_events integer NOT NULL DEFAULT 5 CHECK (minimum_baseline_events BETWEEN 0 AND 1000000),
  new_tenant_grace_days integer NOT NULL DEFAULT 14 CHECK (new_tenant_grace_days BETWEEN 0 AND 365),
  repeat_alert_after_days integer NOT NULL DEFAULT 7 CHECK (repeat_alert_after_days BETWEEN 1 AND 365),
  recovery_notifications_enabled boolean NOT NULL DEFAULT true,
  include_test_tenants boolean NOT NULL DEFAULT false,
  config_version integer NOT NULL DEFAULT 1 CHECK (config_version > 0),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.bump_health_score_settings_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.config_version := OLD.config_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bump_health_score_settings_version ON public.health_score_settings;
CREATE TRIGGER bump_health_score_settings_version
  BEFORE UPDATE ON public.health_score_settings
  FOR EACH ROW EXECUTE FUNCTION public.bump_health_score_settings_version();

INSERT INTO public.health_score_settings (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.health_score_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_health_score_recipients_email_lower
  ON public.health_score_recipients (lower(email));

CREATE TABLE IF NOT EXISTS public.health_score_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key text UNIQUE,
  trigger_type text NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  evaluated_at timestamptz NOT NULL,
  settings_version integer NOT NULL,
  tenant_count integer NOT NULL DEFAULT 0,
  at_risk_count integer NOT NULL DEFAULT 0,
  new_incident_count integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_health_score_runs_evaluated_at
  ON public.health_score_runs (evaluated_at DESC);

CREATE TABLE IF NOT EXISTS public.tenant_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.health_score_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  evaluated_at timestamptz NOT NULL,
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  baseline_period_start timestamptz NOT NULL,
  baseline_period_end timestamptz NOT NULL,
  current_count integer NOT NULL DEFAULT 0 CHECK (current_count >= 0),
  baseline_count integer NOT NULL DEFAULT 0 CHECK (baseline_count >= 0),
  health_score integer CHECK (health_score BETWEEN 0 AND 100),
  activity_change_percent numeric,
  status text NOT NULL CHECK (status IN ('healthy', 'watch', 'at_risk', 'dormant', 'recovering', 'insufficient_data', 'data_issue')),
  confidence text NOT NULL CHECK (confidence IN ('high', 'low', 'insufficient', 'data_issue')),
  last_activity_at timestamptz,
  last_login_at timestamptz,
  subscription_status text,
  subscription_cancel_at timestamptz,
  settings_version integer NOT NULL,
  data_quality_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  incident_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_health_snapshots_tenant_evaluated
  ON public.tenant_health_snapshots (tenant_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_health_snapshots_status_evaluated
  ON public.tenant_health_snapshots (status, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS public.tenant_health_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  opened_snapshot_id uuid NOT NULL REFERENCES public.tenant_health_snapshots(id) ON DELETE RESTRICT,
  latest_snapshot_id uuid NOT NULL REFERENCES public.tenant_health_snapshots(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'acknowledged', 'contacted', 'snoozed', 'resolved')),
  reason text NOT NULL CHECK (reason IN ('threshold_breach', 'dormant')),
  assigned_to uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 5000),
  recovery_streak integer NOT NULL DEFAULT 0 CHECK (recovery_streak >= 0),
  opened_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  contacted_at timestamptz,
  snoozed_until timestamptz,
  resolved_at timestamptz,
  last_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_health_snapshots
  DROP CONSTRAINT IF EXISTS tenant_health_snapshots_incident_id_fkey;
ALTER TABLE public.tenant_health_snapshots
  ADD CONSTRAINT tenant_health_snapshots_incident_id_fkey
  FOREIGN KEY (incident_id) REFERENCES public.tenant_health_incidents(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_health_one_active_incident
  ON public.tenant_health_incidents (tenant_id)
  WHERE state <> 'resolved';
CREATE INDEX IF NOT EXISTS idx_tenant_health_incidents_state
  ON public.tenant_health_incidents (state, opened_at DESC);

DROP TRIGGER IF EXISTS set_tenant_health_incidents_updated_at ON public.tenant_health_incidents;
CREATE TRIGGER set_tenant_health_incidents_updated_at
  BEFORE UPDATE ON public.tenant_health_incidents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.health_alert_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.health_score_runs(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES public.tenant_health_incidents(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES public.tenant_health_snapshots(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('transition', 'reminder', 'recovery')),
  recipient_emails text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'no_recipients')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (incident_id, snapshot_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_health_alert_outbox_pending
  ON public.health_alert_outbox (created_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.health_alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL REFERENCES public.health_alert_outbox(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  provider_message_id text,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outbox_id, recipient_email)
);

DROP TRIGGER IF EXISTS set_health_alert_deliveries_updated_at ON public.health_alert_deliveries;
CREATE TRIGGER set_health_alert_deliveries_updated_at
  BEFORE UPDATE ON public.health_alert_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS. Browser access is Super Admin only; the Edge Function uses service
--    role and therefore bypasses RLS.
-- ---------------------------------------------------------------------------

ALTER TABLE public.health_score_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_score_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_score_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_health_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_alert_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_alert_deliveries ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON public.health_score_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_score_recipients TO authenticated;
GRANT SELECT ON public.health_score_runs TO authenticated;
GRANT SELECT ON public.tenant_health_snapshots TO authenticated;
GRANT SELECT, UPDATE ON public.tenant_health_incidents TO authenticated;
GRANT SELECT ON public.health_alert_outbox TO authenticated;
GRANT SELECT ON public.health_alert_deliveries TO authenticated;
GRANT ALL ON public.health_score_settings, public.health_score_recipients,
  public.health_score_runs, public.tenant_health_snapshots,
  public.tenant_health_incidents, public.health_alert_outbox,
  public.health_alert_deliveries TO service_role;

CREATE POLICY "Super admins manage health settings"
  ON public.health_score_settings FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "Super admins manage health recipients"
  ON public.health_score_recipients FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "Super admins read health runs"
  ON public.health_score_runs FOR SELECT TO authenticated
  USING (public.is_super_admin());
CREATE POLICY "Super admins read health snapshots"
  ON public.tenant_health_snapshots FOR SELECT TO authenticated
  USING (public.is_super_admin());
CREATE POLICY "Super admins manage health incidents"
  ON public.tenant_health_incidents FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "Super admins read health outbox"
  ON public.health_alert_outbox FOR SELECT TO authenticated
  USING (public.is_super_admin());
CREATE POLICY "Super admins read health deliveries"
  ON public.health_alert_deliveries FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 4. Atomic evaluator.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.evaluate_tenant_health(
  p_trigger text DEFAULT 'scheduled',
  p_force boolean DEFAULT false,
  p_evaluated_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.health_score_settings%ROWTYPE;
  v_run_id uuid;
  v_run_key text;
  v_existing_run public.health_score_runs%ROWTYPE;
  v_recipients text[];
  v_snapshot record;
  v_incident public.tenant_health_incidents%ROWTYPE;
  v_incident_id uuid;
  v_new_incidents integer := 0;
  v_tenant_count integer := 0;
  v_at_risk_count integer := 0;
  v_recovery_streak integer;
BEGIN
  IF p_trigger NOT IN ('scheduled', 'manual') THEN
    RAISE EXCEPTION 'Invalid trigger type';
  END IF;
  IF auth.role() <> 'service_role' AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('drive247-health-score-evaluator-v1')) THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'evaluation_already_running');
  END IF;

  SELECT * INTO v_settings
  FROM public.health_score_settings
  WHERE singleton = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Health Score settings are missing';
  END IF;

  IF NOT v_settings.enabled AND p_trigger = 'scheduled' THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'feature_disabled');
  END IF;

  v_run_key := CASE
    WHEN p_trigger = 'scheduled' AND NOT p_force
      THEN format('scheduled:%s:%s', v_settings.config_version, (p_evaluated_at AT TIME ZONE 'UTC')::date)
    ELSE format('%s:%s', p_trigger, gen_random_uuid())
  END;

  SELECT * INTO v_existing_run
  FROM public.health_score_runs
  WHERE run_key = v_run_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', 'already_evaluated',
      'run_id', v_existing_run.id,
      'tenant_count', v_existing_run.tenant_count,
      'at_risk_count', v_existing_run.at_risk_count
    );
  END IF;

  INSERT INTO public.health_score_runs (run_key, trigger_type, status, evaluated_at, settings_version)
  VALUES (v_run_key, p_trigger, 'running', p_evaluated_at, v_settings.config_version)
  RETURNING id INTO v_run_id;

  SELECT COALESCE(array_agg(lower(trim(email)) ORDER BY lower(trim(email))), '{}'::text[])
  INTO v_recipients
  FROM public.health_score_recipients
  WHERE enabled = true;

  WITH eligible_tenants AS (
    SELECT
      t.id,
      t.created_at,
      sub.status AS subscription_status,
      sub.cancel_at AS subscription_cancel_at
    FROM public.tenants t
    LEFT JOIN LATERAL (
      SELECT s.status, s.cancel_at
      FROM public.tenant_subscriptions s
      WHERE s.tenant_id = t.id
      ORDER BY s.created_at DESC
      LIMIT 1
    ) sub ON true
    WHERE lower(COALESCE(t.status, '')) = 'active'
      AND (v_settings.include_test_tenants OR COALESCE(t.tenant_type, 'production') <> 'test')
      -- Legacy active tenants can pre-date tenant_subscriptions. Keep them in
      -- monitoring, but exclude subscriptions known to have ended.
      AND (sub.status IS NULL OR sub.status IN ('active', 'trialing', 'past_due'))
  ), activity AS (
    SELECT
      et.id AS tenant_id,
      et.created_at AS tenant_created_at,
      et.subscription_status,
      et.subscription_cancel_at,
      COUNT(al.id) FILTER (
        WHERE al.activity_source = 'tenant_user'
          AND al.action <> 'login_failed'
          AND al.created_at >= p_evaluated_at - make_interval(days => v_settings.period_days)
          AND al.created_at < p_evaluated_at
      )::integer AS current_count,
      COUNT(al.id) FILTER (
        WHERE al.activity_source = 'tenant_user'
          AND al.action <> 'login_failed'
          AND al.created_at >= p_evaluated_at - make_interval(days => v_settings.period_days * 2)
          AND al.created_at < p_evaluated_at - make_interval(days => v_settings.period_days)
      )::integer AS baseline_count,
      MAX(al.created_at) FILTER (
        WHERE al.activity_source = 'tenant_user'
          AND al.action <> 'login_failed'
          AND al.created_at < p_evaluated_at
      ) AS last_activity_at,
      MAX(al.created_at) FILTER (
        WHERE al.activity_source = 'tenant_user'
          AND al.action = 'login_success'
          AND al.created_at < p_evaluated_at
      ) AS last_login_at,
      COUNT(al.id) FILTER (
        WHERE al.activity_source <> 'tenant_user'
          AND al.created_at >= p_evaluated_at - make_interval(days => v_settings.period_days * 2)
          AND al.created_at < p_evaluated_at
      )::integer AS excluded_count,
      COUNT(al.id) FILTER (
        WHERE al.activity_source = 'unknown'
          AND al.created_at >= p_evaluated_at - make_interval(days => v_settings.period_days * 2)
          AND al.created_at < p_evaluated_at
      )::integer AS unattributed_count
    FROM eligible_tenants et
    LEFT JOIN public.audit_logs al
      ON al.tenant_id = et.id
     AND al.created_at >= p_evaluated_at - make_interval(days => v_settings.period_days * 2)
     AND al.created_at < p_evaluated_at
    GROUP BY et.id, et.created_at, et.subscription_status, et.subscription_cancel_at
  ), scored AS (
    SELECT
      a.*,
      COALESCE(a.tenant_created_at, '-infinity'::timestamptz) <=
        p_evaluated_at - make_interval(days => GREATEST(v_settings.period_days * 2, v_settings.new_tenant_grace_days))
        AS has_complete_history,
      CASE
        WHEN COALESCE(a.tenant_created_at, '-infinity'::timestamptz) >
          p_evaluated_at - make_interval(days => GREATEST(v_settings.period_days * 2, v_settings.new_tenant_grace_days)) THEN NULL
        WHEN a.baseline_count = 0 AND a.current_count > 0 THEN 100
        WHEN a.baseline_count = 0 AND a.current_count = 0 THEN 0
        ELSE LEAST(100, round(a.current_count::numeric * 100 / NULLIF(a.baseline_count, 0))::integer)
      END AS score,
      CASE
        WHEN a.baseline_count = 0 THEN NULL
        ELSE round((a.current_count - a.baseline_count)::numeric * 100 / a.baseline_count, 1)
      END AS change_percent
    FROM activity a
  ), final_scores AS (
    SELECT
      s.*,
      CASE
        WHEN NOT s.has_complete_history THEN 'insufficient_data'
        WHEN s.current_count = 0 AND s.baseline_count = 0 AND s.unattributed_count > 0 THEN 'data_issue'
        WHEN s.current_count = 0 THEN 'dormant'
        WHEN s.baseline_count < v_settings.minimum_baseline_events AND s.score <= v_settings.threshold_percent THEN 'watch'
        WHEN s.score <= v_settings.threshold_percent THEN 'at_risk'
        WHEN s.score <= v_settings.threshold_percent + 20 THEN 'watch'
        ELSE 'healthy'
      END AS calculated_status,
      CASE
        WHEN NOT s.has_complete_history THEN 'insufficient'
        WHEN s.current_count = 0 AND s.baseline_count = 0 AND s.unattributed_count > 0 THEN 'data_issue'
        WHEN s.baseline_count < v_settings.minimum_baseline_events AND s.current_count > 0 THEN 'low'
        ELSE 'high'
      END AS calculated_confidence
    FROM scored s
  )
  INSERT INTO public.tenant_health_snapshots (
    run_id, tenant_id, evaluated_at,
    current_period_start, current_period_end,
    baseline_period_start, baseline_period_end,
    current_count, baseline_count, health_score, activity_change_percent,
    status, confidence, last_activity_at, last_login_at,
    subscription_status, subscription_cancel_at, settings_version, data_quality_details
  )
  SELECT
    v_run_id, fs.tenant_id, p_evaluated_at,
    p_evaluated_at - make_interval(days => v_settings.period_days), p_evaluated_at,
    p_evaluated_at - make_interval(days => v_settings.period_days * 2),
    p_evaluated_at - make_interval(days => v_settings.period_days),
    fs.current_count, fs.baseline_count, fs.score, fs.change_percent,
    fs.calculated_status, fs.calculated_confidence,
    fs.last_activity_at, fs.last_login_at,
    fs.subscription_status, fs.subscription_cancel_at, v_settings.config_version,
    jsonb_build_object(
      'excluded_events_in_comparison_window', fs.excluded_count,
      'unattributed_events_in_comparison_window', fs.unattributed_count,
      'minimum_baseline_events', v_settings.minimum_baseline_events,
      'has_complete_history', fs.has_complete_history
    )
  FROM final_scores fs;

  GET DIAGNOSTICS v_tenant_count = ROW_COUNT;

  FOR v_snapshot IN
    SELECT * FROM public.tenant_health_snapshots WHERE run_id = v_run_id ORDER BY tenant_id
  LOOP
    SELECT * INTO v_incident
    FROM public.tenant_health_incidents
    WHERE tenant_id = v_snapshot.tenant_id AND state <> 'resolved'
    FOR UPDATE;

    IF v_snapshot.status IN ('at_risk', 'dormant') THEN
      v_at_risk_count := v_at_risk_count + 1;

      IF NOT FOUND THEN
        INSERT INTO public.tenant_health_incidents (
          tenant_id, opened_snapshot_id, latest_snapshot_id, reason, opened_at
        ) VALUES (
          v_snapshot.tenant_id,
          v_snapshot.id,
          v_snapshot.id,
          CASE WHEN v_snapshot.status = 'dormant' THEN 'dormant' ELSE 'threshold_breach' END,
          p_evaluated_at
        ) RETURNING id INTO v_incident_id;

        UPDATE public.tenant_health_snapshots
        SET incident_id = v_incident_id
        WHERE id = v_snapshot.id;

        INSERT INTO public.health_alert_outbox (
          run_id, incident_id, snapshot_id, kind, recipient_emails, status
        ) VALUES (
          v_run_id, v_incident_id, v_snapshot.id, 'transition', v_recipients,
          CASE WHEN cardinality(v_recipients) = 0 THEN 'no_recipients' ELSE 'pending' END
        ) ON CONFLICT DO NOTHING;

        v_new_incidents := v_new_incidents + 1;
      ELSE
        v_incident_id := v_incident.id;

        UPDATE public.tenant_health_incidents
        SET latest_snapshot_id = v_snapshot.id,
            recovery_streak = 0,
            state = CASE
              WHEN state = 'snoozed' AND snoozed_until <= p_evaluated_at THEN 'open'
              ELSE state
            END,
            snoozed_until = CASE
              WHEN state = 'snoozed' AND snoozed_until <= p_evaluated_at THEN NULL
              ELSE snoozed_until
            END
        WHERE id = v_incident_id;

        UPDATE public.tenant_health_snapshots
        SET incident_id = v_incident_id
        WHERE id = v_snapshot.id;

        IF cardinality(v_recipients) > 0
          AND (v_incident.snoozed_until IS NULL OR v_incident.snoozed_until <= p_evaluated_at)
          AND (
            v_incident.last_notified_at IS NULL
            OR v_incident.last_notified_at <= p_evaluated_at - make_interval(days => v_settings.repeat_alert_after_days)
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.health_alert_outbox o
            WHERE o.incident_id = v_incident_id AND o.status = 'pending'
          )
        THEN
          INSERT INTO public.health_alert_outbox (
            run_id, incident_id, snapshot_id, kind, recipient_emails, status
          ) VALUES (
            v_run_id, v_incident_id, v_snapshot.id, 'reminder', v_recipients,
            CASE WHEN cardinality(v_recipients) = 0 THEN 'no_recipients' ELSE 'pending' END
          ) ON CONFLICT DO NOTHING;
        END IF;
      END IF;

    ELSIF FOUND AND v_snapshot.status NOT IN ('insufficient_data', 'data_issue') THEN
      -- Hysteresis: one evaluation above threshold+10 starts recovery; two
      -- consecutive evaluations resolve the incident.
      IF v_snapshot.health_score IS NOT NULL
        AND v_snapshot.health_score >= LEAST(100, v_settings.threshold_percent + 10)
      THEN
        v_recovery_streak := v_incident.recovery_streak + 1;
        UPDATE public.tenant_health_snapshots
        SET status = 'recovering', incident_id = v_incident.id
        WHERE id = v_snapshot.id;

        IF v_recovery_streak >= 2 THEN
          UPDATE public.tenant_health_incidents
          SET latest_snapshot_id = v_snapshot.id,
              recovery_streak = v_recovery_streak,
              state = 'resolved',
              resolved_at = p_evaluated_at,
              snoozed_until = NULL
          WHERE id = v_incident.id;

          IF v_settings.recovery_notifications_enabled THEN
            INSERT INTO public.health_alert_outbox (
              run_id, incident_id, snapshot_id, kind, recipient_emails, status
            ) VALUES (
              v_run_id, v_incident.id, v_snapshot.id, 'recovery', v_recipients,
              CASE WHEN cardinality(v_recipients) = 0 THEN 'no_recipients' ELSE 'pending' END
            ) ON CONFLICT DO NOTHING;
          END IF;
        ELSE
          UPDATE public.tenant_health_incidents
          SET latest_snapshot_id = v_snapshot.id,
              recovery_streak = v_recovery_streak
          WHERE id = v_incident.id;
        END IF;
      ELSE
        UPDATE public.tenant_health_incidents
        SET latest_snapshot_id = v_snapshot.id,
            recovery_streak = 0
        WHERE id = v_incident.id;
        UPDATE public.tenant_health_snapshots
        SET incident_id = v_incident.id
        WHERE id = v_snapshot.id;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.health_score_runs
  SET status = 'succeeded',
      tenant_count = v_tenant_count,
      at_risk_count = v_at_risk_count,
      new_incident_count = v_new_incidents,
      completed_at = now()
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'status', 'succeeded',
    'run_id', v_run_id,
    'tenant_count', v_tenant_count,
    'at_risk_count', v_at_risk_count,
    'new_incident_count', v_new_incidents
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_tenant_health(text, boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_tenant_health(text, boolean, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Read models and dashboard/detail helpers.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_latest_tenant_health
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (s.tenant_id)
  s.id AS snapshot_id,
  s.tenant_id,
  t.company_name,
  t.slug,
  t.tenant_type,
  t.status AS tenant_status,
  t.subscription_plan,
  s.evaluated_at,
  s.current_period_start,
  s.current_period_end,
  s.baseline_period_start,
  s.baseline_period_end,
  s.current_count,
  s.baseline_count,
  s.health_score,
  s.activity_change_percent,
  s.status,
  s.confidence,
  s.last_activity_at,
  s.last_login_at,
  s.subscription_status,
  s.subscription_cancel_at,
  s.settings_version,
  s.data_quality_details,
  s.incident_id,
  i.state AS incident_state,
  i.reason AS incident_reason,
  i.opened_at AS risk_since,
  i.acknowledged_at,
  i.contacted_at,
  i.snoozed_until,
  i.resolved_at,
  i.assigned_to,
  i.notes,
  i.last_notified_at
FROM public.tenant_health_snapshots s
JOIN public.tenants t ON t.id = s.tenant_id
LEFT JOIN public.tenant_health_incidents i ON i.id = s.incident_id
ORDER BY s.tenant_id, s.evaluated_at DESC, s.created_at DESC;

GRANT SELECT ON public.v_latest_tenant_health TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_health_score_config(
  p_expected_version integer,
  p_enabled boolean,
  p_period_days integer,
  p_threshold_percent integer,
  p_minimum_baseline_events integer,
  p_new_tenant_grace_days integer,
  p_repeat_alert_after_days integer,
  p_recovery_notifications_enabled boolean,
  p_include_test_tenants boolean,
  p_recipient_emails text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.health_score_settings%ROWTYPE;
  v_emails text[];
  v_updated_version integer;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Normalise once inside the transaction. This makes case-only duplicates
  -- impossible and keeps the browser from partially saving settings before a
  -- recipient insert fails.
  SELECT COALESCE(array_agg(email ORDER BY email), '{}'::text[])
  INTO v_emails
  FROM (
    SELECT DISTINCT lower(btrim(raw_email)) AS email
    FROM unnest(COALESCE(p_recipient_emails, '{}'::text[])) raw_email
    WHERE btrim(raw_email) <> ''
  ) normalised;

  IF EXISTS (
    SELECT 1 FROM unnest(v_emails) email
    WHERE email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ) THEN
    RAISE EXCEPTION 'One or more recipient email addresses are invalid';
  END IF;

  SELECT * INTO v_settings
  FROM public.health_score_settings
  WHERE singleton = true
  FOR UPDATE;

  IF NOT FOUND OR v_settings.config_version <> p_expected_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'Health Score settings changed in another session';
  END IF;

  UPDATE public.health_score_settings
  SET enabled = p_enabled,
      period_days = p_period_days,
      threshold_percent = p_threshold_percent,
      minimum_baseline_events = p_minimum_baseline_events,
      new_tenant_grace_days = p_new_tenant_grace_days,
      repeat_alert_after_days = p_repeat_alert_after_days,
      recovery_notifications_enabled = p_recovery_notifications_enabled,
      include_test_tenants = p_include_test_tenants,
      updated_by = (
        SELECT id FROM public.app_users WHERE auth_user_id = auth.uid() LIMIT 1
      )
  WHERE id = v_settings.id
  RETURNING config_version INTO v_updated_version;

  -- Keep only the requested recipients. The explicit predicate is required by
  -- pg-safeupdate and avoids destroying/recreating recipients that did not
  -- change (which also preserves their stable IDs and creation timestamps).
  DELETE FROM public.health_score_recipients recipient
  WHERE NOT (lower(recipient.email) = ANY(v_emails));

  INSERT INTO public.health_score_recipients (email, created_by)
  SELECT requested.email, (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid() LIMIT 1)
  FROM unnest(v_emails) AS requested(email)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.health_score_recipients existing
    WHERE lower(existing.email) = requested.email
  );

  RETURN jsonb_build_object(
    'config_version', v_updated_version,
    'recipient_count', cardinality(v_emails)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_health_score_config(integer, boolean, integer, integer, integer, integer, integer, boolean, boolean, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_health_score_config(integer, boolean, integer, integer, integer, integer, integer, boolean, boolean, text[]) TO authenticated;

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
      COALESCE(created_at, '-infinity'::timestamptz) <= p_evaluated_at - make_interval(days => GREATEST(p_period_days * 2, p_new_tenant_grace_days)) AS complete,
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
    'data_issue', count(*) FILTER (WHERE complete AND current_count = 0 AND baseline_count = 0 AND unattributed_count > 0),
    'dormant', count(*) FILTER (WHERE complete AND current_count = 0 AND NOT (baseline_count = 0 AND unattributed_count > 0)),
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

CREATE OR REPLACE FUNCTION public.get_health_score_dashboard(p_history_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH latest AS (
    SELECT * FROM public.v_latest_tenant_health
  ), daily_latest AS (
    SELECT DISTINCT ON (s.tenant_id, (s.evaluated_at AT TIME ZONE 'UTC')::date)
      s.tenant_id,
      (s.evaluated_at AT TIME ZONE 'UTC')::date AS day,
      s.status
    FROM public.tenant_health_snapshots s
    WHERE s.evaluated_at >= now() - make_interval(days => LEAST(GREATEST(p_history_days, 1), 365))
    ORDER BY s.tenant_id, (s.evaluated_at AT TIME ZONE 'UTC')::date, s.evaluated_at DESC
  ), trend AS (
    SELECT day,
      count(*) FILTER (WHERE status = 'healthy') AS healthy,
      count(*) FILTER (WHERE status IN ('watch', 'recovering')) AS watch,
      count(*) FILTER (WHERE status IN ('at_risk', 'dormant')) AS at_risk,
      count(*) FILTER (WHERE status IN ('insufficient_data', 'data_issue')) AS unavailable
    FROM daily_latest GROUP BY day ORDER BY day
  ), last_run AS (
    SELECT id, evaluated_at, completed_at, status, tenant_count, at_risk_count, new_incident_count, error_message
    FROM public.health_score_runs
    ORDER BY started_at DESC LIMIT 1
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'monitored', (SELECT count(*) FROM latest),
      'at_risk', (SELECT count(*) FROM latest WHERE status IN ('at_risk', 'dormant')),
      'new_at_risk', (SELECT count(*) FROM latest WHERE status IN ('at_risk', 'dormant') AND risk_since >= now() - interval '24 hours'),
      'watch', (SELECT count(*) FROM latest WHERE status IN ('watch', 'recovering')),
      'insufficient', (SELECT count(*) FROM latest WHERE status IN ('insufficient_data', 'data_issue')),
      'median_score', COALESCE((SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY health_score) FROM latest WHERE health_score IS NOT NULL AND status NOT IN ('insufficient_data', 'data_issue')), 0)
    ),
    'trend', COALESCE((SELECT jsonb_agg(to_jsonb(trend) ORDER BY day) FROM trend), '[]'::jsonb),
    'last_run', (SELECT to_jsonb(last_run) FROM last_run)
  )
  WHERE auth.role() = 'service_role' OR public.is_super_admin();
$$;

REVOKE ALL ON FUNCTION public.get_health_score_dashboard(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_health_score_dashboard(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_tenant_health_activity(
  p_tenant_id uuid,
  p_period_days integer DEFAULT 30,
  p_anchor timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH days AS (
    SELECT generate_series(0, LEAST(GREATEST(p_period_days, 1), 365) - 1) AS day_index
  ), qualifying AS (
    SELECT al.*
    FROM public.audit_logs al
    WHERE al.tenant_id = p_tenant_id
      AND al.activity_source = 'tenant_user'
      AND al.action <> 'login_failed'
      AND al.created_at >= p_anchor - make_interval(days => LEAST(GREATEST(p_period_days, 1), 365) * 2)
      AND al.created_at < p_anchor
  ), daily AS (
    SELECT d.day_index,
      (p_anchor - make_interval(days => LEAST(GREATEST(p_period_days, 1), 365) - d.day_index))::date AS current_day,
      (p_anchor - make_interval(days => LEAST(GREATEST(p_period_days, 1), 365) * 2 - d.day_index))::date AS baseline_day,
      count(q.id) FILTER (
        WHERE q.created_at >= p_anchor - make_interval(days => LEAST(GREATEST(p_period_days, 1), 365) - d.day_index)
          AND q.created_at < p_anchor - make_interval(days => LEAST(GREATEST(p_period_days, 1), 365) - d.day_index - 1)
      ) AS current_count,
      count(q.id) FILTER (
        WHERE q.created_at >= p_anchor - make_interval(days => LEAST(GREATEST(p_period_days, 1), 365) * 2 - d.day_index)
          AND q.created_at < p_anchor - make_interval(days => LEAST(GREATEST(p_period_days, 1), 365) * 2 - d.day_index - 1)
      ) AS baseline_count
    FROM days d LEFT JOIN qualifying q ON true
    GROUP BY d.day_index
  ), entity_counts AS (
    SELECT COALESCE(entity_type, 'other') AS entity_type, count(*) AS count
    FROM qualifying
    WHERE created_at >= p_anchor - make_interval(days => LEAST(GREATEST(p_period_days, 1), 365))
    GROUP BY COALESCE(entity_type, 'other')
    ORDER BY count(*) DESC
    LIMIT 10
  ), recent AS (
    SELECT id, action, entity_type, entity_id, created_at
    FROM qualifying ORDER BY created_at DESC LIMIT 20
  )
  SELECT jsonb_build_object(
    'daily', COALESCE((SELECT jsonb_agg(to_jsonb(daily) ORDER BY day_index) FROM daily), '[]'::jsonb),
    'entity_counts', COALESCE((SELECT jsonb_agg(to_jsonb(entity_counts)) FROM entity_counts), '[]'::jsonb),
    'recent_actions', COALESCE((SELECT jsonb_agg(to_jsonb(recent) ORDER BY created_at DESC) FROM recent), '[]'::jsonb)
  )
  WHERE auth.role() = 'service_role' OR public.is_super_admin();
$$;

REVOKE ALL ON FUNCTION public.get_tenant_health_activity(uuid, integer, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tenant_health_activity(uuid, integer, timestamptz) TO authenticated, service_role;

COMMENT ON TABLE public.tenant_health_snapshots IS
  'Immutable per-run tenant activity comparisons used by the Super Admin retention Health Score.';
COMMENT ON COLUMN public.tenant_health_snapshots.health_score IS
  'Current qualifying audit activity as a percentage of the preceding equal-length period, capped at 100.';
COMMENT ON COLUMN public.audit_logs.activity_source IS
  'Provenance classification for engagement analytics. Only tenant_user rows count toward Health Score.';

-- ---------------------------------------------------------------------------
-- 6. Daily cron. Clone the existing onboarding digest command so the platform
--    secret stays out of source control, replacing only the function path.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('evaluate-health-scores');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'evaluate-health-scores',
  '30 6 * * *',
  replace(source.command, source.function_name, 'evaluate-health-scores')
)
FROM (
  -- Prefer the platform-secret pattern. Older environments may not yet have
  -- that job, so fall back to the existing service-role cron credential.
  SELECT command, 'onboarding-daily-digest'::text AS function_name, 1 AS priority
  FROM cron.job WHERE jobname = 'onboarding-daily-digest'
  UNION ALL
  SELECT command, 'accrue-payg-charges'::text AS function_name, 2 AS priority
  FROM cron.job WHERE jobname = 'accrue-payg-charges'
  ORDER BY priority
  LIMIT 1
) source;
