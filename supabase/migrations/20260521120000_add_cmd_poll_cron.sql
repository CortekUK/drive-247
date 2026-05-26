-- Cron job for CMD polling fallback.
--
-- Modives' webhook isn't pointed at us yet. Until it is, run cmd-poll-pending
-- every minute to sync the cmd_license_status field on any pending
-- identity_verifications row. The function is idempotent and a no-op when
-- nothing is pending, so it's safe to leave running.
--
-- To disable once the webhook is configured:
--   SELECT cron.unschedule('cmd-poll-pending');

CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";

DO $$
BEGIN
  PERFORM cron.unschedule('cmd-poll-pending');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'cmd-poll-pending',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/cmd-poll-pending',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
