-- Migration: Set up pg_cron job for lockbox scheduled send
-- Runs every minute to check for lockbox codes that need to be auto-sent
-- The edge function is idempotent — only processes rentals where
-- lockbox_sent_at IS NULL and approved_at + offset <= now()
-- The function has verify_jwt = false in config.toml so no auth header needed

-- Ensure pg_net extension is available for HTTP calls from pg_cron
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";

-- Remove existing job if present (idempotent re-run)
DO $$
BEGIN
  PERFORM cron.unschedule('send-lockbox-scheduled');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist yet, that's fine
  NULL;
END $$;

-- Schedule: every minute, call the send-lockbox-scheduled edge function
SELECT cron.schedule(
  'send-lockbox-scheduled',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/send-lockbox-scheduled',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
