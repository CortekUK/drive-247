-- Revenue Optimiser Phase 3 — schedule the two new crons.
--   autopilot-run     — 08:00 UTC (1h after the daily generate cron at 07:00)
--   anomaly-check     — every 6 hours starting at 02:00 UTC
--
-- Same Vault pattern as Phase 2 crons (20260524130000_schedule_phase2_crons.sql).
DO $$
DECLARE
  service_key text;
  project_url text := 'https://hviqoaokxvlancmftwuo.supabase.co';
BEGIN
  BEGIN
    SELECT decrypted_secret INTO service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    service_key := NULL;
  END;

  PERFORM cron.schedule(
    'revenue-optimiser-autopilot-run',
    '0 8 * * *',
    format(
      $cron$ SELECT net.http_post(
        url := '%s/functions/v1/revenue-optimiser-autopilot-run',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{}'::jsonb
      ); $cron$,
      project_url, COALESCE(service_key, 'MISSING_SERVICE_KEY')
    )
  );

  PERFORM cron.schedule(
    'revenue-optimiser-anomaly-check',
    '0 2,8,14,20 * * *',
    format(
      $cron$ SELECT net.http_post(
        url := '%s/functions/v1/revenue-optimiser-anomaly-check',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{}'::jsonb
      ); $cron$,
      project_url, COALESCE(service_key, 'MISSING_SERVICE_KEY')
    )
  );
END $$;
