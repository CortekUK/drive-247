-- Migration: Set up pg_cron job for return reminder notifications
-- Runs every 15 minutes to check for rentals approaching their return date
-- The edge function is idempotent — only processes rentals where
-- return_reminder_sent_at IS NULL and end_date is within the reminder window
-- The function has verify_jwt = false in config.toml so no auth header needed

-- Ensure pg_net extension is available for HTTP calls from pg_cron
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";

-- Remove existing job if present (idempotent re-run)
DO $$
BEGIN
  PERFORM cron.unschedule('send-return-reminders');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist yet, that's fine
  NULL;
END $$;

-- Schedule: every 15 minutes, call the send-return-reminders edge function
SELECT cron.schedule(
  'send-return-reminders',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/send-return-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
