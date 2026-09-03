-- SECURITY: the production service_role JWT was redacted from this file on
-- 2026-09-03. Redaction does NOT undo the exposure — the token is in git
-- history and on origin/main. Rotating the key in Supabase is the only fix.
-- To restore a job, read its command live: SELECT command FROM cron.job WHERE jobname = '...';

-- ROLLBACK: recreate these cron jobs exactly as they were, Thu Sep  3 08:42:54 UTC 2026

-- jobid 50
SELECT cron.schedule('accounting-oauth-state-reap', '0 * * * *', ' SELECT public.accounting_oauth_state_reap(); ');

-- jobid 40
SELECT cron.schedule('automation-poll-pending-every-minute', '* * * * *', '
  SELECT net.http_post(
    url := ''https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/automation-poll-pending'',
    headers := ''{"Content-Type": "application/json", "Authorization": "Bearer <<REDACTED — recover with: SELECT command FROM cron.job WHERE jobname = ...>>"}''::jsonb,
    body := ''{}''::jsonb
  );
  ');

-- jobid 65
SELECT cron.schedule('dispatch-strategy-call-emails', '* * * * *', '
  SELECT net.http_post(
    url := ''https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/dispatch-strategy-call-emails'',
    headers := ''{"Content-Type": "application/json", "Authorization": "Bearer <<REDACTED — recover with: SELECT command FROM cron.job WHERE jobname = ...>>"}''::jsonb,
    body := ''{}''::jsonb
  );
  ');

-- jobid 66
SELECT cron.schedule('evaluate-fleet-health', '0 2 * * *', 'SELECT public.evaluate_fleet_health();');

-- jobid 51
SELECT cron.schedule('process-accounting-sync', '*/2 * * * *', ' SELECT net.http_post(
        url := ''https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/process-accounting-sync'',
        headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'', ''Bearer <<REDACTED — recover with: SELECT command FROM cron.job WHERE jobname = ...>>''),
        body := ''{}''::jsonb
      ); ');

-- jobid 52
SELECT cron.schedule('process-backfill-jobs', '* * * * *', ' SELECT net.http_post(
        url := ''https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/process-backfill-jobs'',
        headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'', ''Bearer <<REDACTED — recover with: SELECT command FROM cron.job WHERE jobname = ...>>''),
        body := ''{}''::jsonb
      ); ');

-- jobid 49
SELECT cron.schedule('refresh-accounting-tokens', '*/10 * * * *', ' SELECT net.http_post(
        url := ''https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/refresh-accounting-tokens'',
        headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'', ''Bearer <<REDACTED — recover with: SELECT command FROM cron.job WHERE jobname = ...>>''),
        body := ''{}''::jsonb
      ); ');

-- jobid 68
SELECT cron.schedule('refresh-square-tokens', '*/10 * * * *', ' SELECT net.http_post(
        url := ''https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/refresh-square-tokens'',
        headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'', ''Bearer <<REDACTED — recover with: SELECT command FROM cron.job WHERE jobname = ...>>''),
        body := ''{}''::jsonb
      ); ');
