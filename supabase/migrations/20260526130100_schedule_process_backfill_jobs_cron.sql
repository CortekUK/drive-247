-- Finance Sync — Sprint 4: schedule the backfill worker.
-- Runs every 1 minute — fast enough that a tenant clicking "Start backfill"
-- sees progress within seconds, slow enough not to burn cron slots.
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
    'process-backfill-jobs',
    '* * * * *',
    format(
      $cron$ SELECT net.http_post(
        url := '%s/functions/v1/process-backfill-jobs',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{}'::jsonb
      ); $cron$,
      project_url, COALESCE(service_key, 'MISSING_SERVICE_KEY')
    )
  );
END $$;
