-- Fix recipient saves on projects with pg-safeupdate enabled. The original
-- function used an unqualified DELETE while replacing the recipient list,
-- which PostgreSQL correctly rejected with "DELETE requires a WHERE clause".

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
