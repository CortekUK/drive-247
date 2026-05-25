-- Revenue Optimiser Phase 2 — schedule the three daily crons.
--   1. generate           — 07:00 UTC (produces fresh recs)
--   2. daily-email        — 07:30 UTC (after generate has finished writing)
--   3. measure-outcomes   — 06:00 UTC (before generate so outcomes feed the new run)
--
-- All three call edge functions via net.http_post with the service_role key
-- pulled from Vault. Same pattern as generate-insights.
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
    'revenue-optimiser-measure-outcomes',
    '0 6 * * *',
    format(
      $cron$ SELECT net.http_post(
        url := '%s/functions/v1/revenue-optimiser-measure-outcomes',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{}'::jsonb
      ); $cron$,
      project_url, COALESCE(service_key, 'MISSING_SERVICE_KEY')
    )
  );

  PERFORM cron.schedule(
    'revenue-optimiser-generate',
    '0 7 * * *',
    format(
      $cron$ SELECT net.http_post(
        url := '%s/functions/v1/revenue-optimiser-generate',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{}'::jsonb
      ); $cron$,
      project_url, COALESCE(service_key, 'MISSING_SERVICE_KEY')
    )
  );

  PERFORM cron.schedule(
    'revenue-optimiser-daily-email',
    '30 7 * * *',
    format(
      $cron$ SELECT net.http_post(
        url := '%s/functions/v1/revenue-optimiser-daily-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{}'::jsonb
      ); $cron$,
      project_url, COALESCE(service_key, 'MISSING_SERVICE_KEY')
    )
  );
END $$;

COMMENT ON EXTENSION pg_cron IS 'Cron jobs in Supabase';
