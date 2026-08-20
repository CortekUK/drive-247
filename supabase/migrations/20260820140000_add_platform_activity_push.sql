-- ---------------------------------------------------------------------------
-- Platform activity push — super-admin notifications for "somebody did
-- something", anywhere on the platform.
--
-- Source of truth is `audit_logs`, which already records every meaningful
-- action across all tenants and is low volume (~30 rows/day). That makes an
-- INSERT trigger safe here in a way it would not be on rentals or payments, and
-- it means new event types are picked up automatically as the app logs them —
-- no new plumbing per event.
--
-- A super admin is NOT tenant-scoped, so their device cannot be stored the way a
-- customer's or an operator's is. Hence a third audience whose rows deliberately
-- carry no tenant.
-- ---------------------------------------------------------------------------

ALTER TYPE public.push_audience ADD VALUE IF NOT EXISTS 'platform';

-- A platform subscription belongs to a super admin, who has no tenant — so the
-- column has to become nullable, and the CHECK keeps that from silently
-- weakening the guarantee for the two tenant-scoped audiences.
ALTER TABLE public.push_subscriptions ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_tenant_scope;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_tenant_scope CHECK (
  (audience = 'platform' AND tenant_id IS NULL AND app_user_id IS NOT NULL)
  OR (audience <> 'platform' AND tenant_id IS NOT NULL)
);

ALTER TABLE public.push_notification_log ALTER COLUMN tenant_id DROP NOT NULL;

-- Super admins must be able to see their own platform devices; the existing
-- policy only matched on tenant, which is NULL for these rows.
DROP POLICY IF EXISTS push_subscriptions_select_own_tenant ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_own_tenant ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS push_notification_log_select_own_tenant ON public.push_notification_log;
CREATE POLICY push_notification_log_select_own_tenant ON public.push_notification_log
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- ---------------------------------------------------------------------------
-- Which actions each super admin wants pushed.
--
-- Per-admin rather than global: two super admins watching the same platform
-- want different things, and a shared row means one person's tuning silently
-- changes the other's alerts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_activity_prefs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL UNIQUE REFERENCES public.app_users(id) ON DELETE CASCADE,
  is_enabled  boolean NOT NULL DEFAULT true,

  -- Allowlist of audit_logs.action values. Empty means "nothing" rather than
  -- "everything": ~40% of audit rows are UI telemetry (`*_dialog_shown`,
  -- `*_warning_shown`, `login_success`), so defaulting to all would make the
  -- feature unusable on day one and train the user to ignore it.
  actions     text[] NOT NULL DEFAULT '{}',

  -- Test tenants generate most of the noise while nothing real is happening.
  include_test_tenants boolean NOT NULL DEFAULT true,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_activity_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_activity_prefs_super_admin ON public.platform_activity_prefs;
CREATE POLICY platform_activity_prefs_super_admin ON public.platform_activity_prefs
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS platform_activity_prefs_service_role ON public.platform_activity_prefs;
CREATE POLICY platform_activity_prefs_service_role ON public.platform_activity_prefs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS set_platform_activity_prefs_updated_at ON public.platform_activity_prefs;
CREATE TRIGGER set_platform_activity_prefs_updated_at
  BEFORE UPDATE ON public.platform_activity_prefs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Dispatch. Modelled on notify_operator_email_dispatch(), including its two
-- load-bearing properties:
--   * it passes ONLY the row id — the function re-reads the row and never
--     trusts caller-supplied content
--   * EXCEPTION WHEN OTHERS returns NEW, so a push problem can never roll back
--     the action that was being audited. An audit write must not be able to fail
--     because a notification could not be sent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_platform_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions'
AS $$
DECLARE
  v_secret text;
BEGIN
  -- Cheap early exit so the common case never touches the network. Nothing is
  -- dispatched unless SOME enabled admin has asked for this exact action.
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_activity_prefs
    WHERE is_enabled AND NEW.action = ANY(actions)
  ) THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_secret
  FROM private.platform_config
  WHERE key = 'platform_notify_secret';

  IF v_secret IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/notify-platform-activity',
    body    := jsonb_build_object('audit_log_id', NEW.id),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-platform-secret', v_secret
               )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_platform_push ON public.audit_logs;
CREATE TRIGGER trg_audit_log_platform_push
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW
  -- Pure UI telemetry never reaches the function, so it cannot be enabled by
  -- accident from the settings screen either.
  WHEN (NEW.action NOT LIKE '%_dialog_shown' AND NEW.action NOT LIKE '%_warning_shown')
  EXECUTE FUNCTION public.notify_platform_activity();
