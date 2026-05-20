-- Fix external calendar sync cron.
-- The original migration (20260417130000) scheduled the job using
--   current_setting('app.settings.supabase_url')
-- but that GUC isn't set on this project, so every run since 2026-04-17 has
-- failed with: ERROR: unrecognized configuration parameter "app.settings.supabase_url".
-- Re-schedule using the hardcoded URL pattern that other working cron jobs
-- in this project use (see send-lockbox-scheduled, send-return-reminders).
-- Both sync-external-calendars and vehicle-ical-export have verify_jwt=false
-- in config.toml, so no Authorization header is required.

DO $$
BEGIN
  PERFORM cron.unschedule('sync-external-calendars');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'sync-external-calendars',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/sync-external-calendars',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
