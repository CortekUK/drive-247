-- Finance Sync — Sprint 2: token refresh cron.
-- Every 10 minutes, runs refresh-accounting-tokens which:
--   1. Selects active accounting_connections rows where token_expires_at < NOW() + 15min
--   2. Calls the provider's refresh endpoint with the vault-stored refresh_token
--   3. Xero ROTATES — must persist new refresh_token. Zoho is stable.
--   4. On 3 consecutive 4xx → flips connection to 'expired' + inserts a reminder.
--
-- Same Vault-secret pattern as the Revenue Optimiser cron migrations.
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
    'refresh-accounting-tokens',
    '*/10 * * * *',
    format(
      $cron$ SELECT net.http_post(
        url := '%s/functions/v1/refresh-accounting-tokens',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{}'::jsonb
      ); $cron$,
      project_url, COALESCE(service_key, 'MISSING_SERVICE_KEY')
    )
  );

  -- Also schedule the oauth_state reaper — runs every hour to sweep nonces
  -- whose 10-minute TTL has elapsed. Tiny operation, doesn't need an edge
  -- function; just call the SQL function directly via pg_cron.
  PERFORM cron.schedule(
    'accounting-oauth-state-reap',
    '0 * * * *',
    $cron$ SELECT public.accounting_oauth_state_reap(); $cron$
  );
END $$;
