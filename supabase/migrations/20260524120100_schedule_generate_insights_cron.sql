-- Revenue Optimiser — schedule the daily insights cron.
-- Runs at 7:10 UTC daily (after the hourly MV refresh at :05 has settled).
-- Direct HTTP call into the edge function via net.http_post + the project's
-- service_role key so it runs as service_role (required by the function's
-- service_role-only SELECT on revenue_optimiser_settings + the MV).
--
-- The service_role key is read from a Supabase Vault secret at execution
-- time — same pattern used elsewhere in this project (see lockbox cron).
-- If the secret isn't set, the call returns 401 and the cron logs an error.

DO $$
DECLARE
  service_key text;
  project_url text := 'https://hviqoaokxvlancmftwuo.supabase.co';
BEGIN
  -- Read the service_role key from vault if present; otherwise the cron
  -- will be created but the call will 401 (operator can set the secret later).
  BEGIN
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    service_key := NULL;
  END;

  PERFORM cron.schedule(
    'revenue-optimiser-generate-insights',
    '10 7 * * *',  -- 07:10 UTC daily
    format(
      $cron$ SELECT net.http_post(
        url := '%s/functions/v1/revenue-optimiser-generate-insights',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer %s'
        ),
        body := '{}'::jsonb
      ); $cron$,
      project_url,
      COALESCE(service_key, 'MISSING_SERVICE_KEY')
    )
  );
END $$;

COMMENT ON EXTENSION pg_cron IS 'Cron jobs in Supabase';
