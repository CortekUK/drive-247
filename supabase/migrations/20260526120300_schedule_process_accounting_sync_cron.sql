-- Finance Sync — Sprint 3: schedule the 2-minute sync worker.
-- Spec §9. Picks up to 100 pending/failed rows per tick and pushes them
-- through the provider abstraction. See process-accounting-sync/index.ts.
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
    'process-accounting-sync',
    '*/2 * * * *',
    format(
      $cron$ SELECT net.http_post(
        url := '%s/functions/v1/process-accounting-sync',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{}'::jsonb
      ); $cron$,
      project_url, COALESCE(service_key, 'MISSING_SERVICE_KEY')
    )
  );
END $$;
