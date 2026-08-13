-- Prevent unattributed-only Data Issue tenants from appearing in the settings
-- preview's alert count when minimum_baseline_events is zero.

DO $migration$
DECLARE
  v_definition text;
  v_old text := '(baseline_count >= p_minimum_baseline_events AND score <= p_threshold_percent)';
  v_new text := '(current_count > 0 AND baseline_count >= p_minimum_baseline_events AND score <= p_threshold_percent)';
BEGIN
  SELECT pg_get_functiondef(
    'public.preview_tenant_health_settings(integer,integer,integer,integer,boolean,timestamp with time zone)'::regprocedure
  ) INTO v_definition;

  IF position(v_old IN v_definition) > 0 THEN
    EXECUTE replace(v_definition, v_old, v_new);
  ELSIF position(v_new IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not locate the Health Score preview alert condition';
  END IF;
END
$migration$;
