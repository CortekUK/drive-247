-- Fix the auto-extension cron jobs.
--
-- Both `auto-extend-rentals` (every 15 min) and `send-auto-extension-reminders`
-- (daily) were built with `current_setting('app.settings.supabase_url')` to
-- compose the edge-function URL. That GUC is not set on this database, so every
-- invocation raised:
--   ERROR: unrecognized configuration parameter "app.settings.supabase_url"
-- and failed BEFORE net.http_post ran — the functions never executed. As a
-- result auto-extend rentals stopped renewing/charging for days while their
-- end_date drifted into the past.
--
-- Fix: hardcode the project URL like every other working cron in this project.
-- Both functions are verify_jwt = false, so no Authorization header is needed
-- (matches send-lockbox-scheduled / send-return-reminders, which post with only
-- a Content-Type header). Referenced by jobname so it is id-independent.

DO $$
DECLARE
  v_url text := 'https://hviqoaokxvlancmftwuo.supabase.co';
  v_job bigint;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'auto-extend-rentals';
  IF v_job IS NOT NULL THEN
    PERFORM cron.alter_job(v_job, command => format($cmd$
  SELECT net.http_post(
    url := '%s/functions/v1/auto-extend-rentals',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$cmd$, v_url));
  END IF;

  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'send-auto-extension-reminders';
  IF v_job IS NOT NULL THEN
    PERFORM cron.alter_job(v_job, command => format($cmd$
  SELECT net.http_post(
    url := '%s/functions/v1/send-auto-extension-reminder',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$cmd$, v_url));
  END IF;
END $$;
