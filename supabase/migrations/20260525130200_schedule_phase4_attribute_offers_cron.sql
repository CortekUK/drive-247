-- Revenue Optimiser Phase 4 — schedule offer-attribution cron at 06:30 UTC
-- (right after measure-outcomes at 06:00 — same pattern as Phase 2 chain).
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
    'revenue-optimiser-attribute-offers',
    '30 6 * * *',
    format(
      $cron$ SELECT net.http_post(
        url := '%s/functions/v1/revenue-optimiser-attribute-offers',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{}'::jsonb
      ); $cron$,
      project_url, COALESCE(service_key, 'MISSING_SERVICE_KEY')
    )
  );
END $$;
