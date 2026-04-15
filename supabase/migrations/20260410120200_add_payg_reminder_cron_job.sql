-- Migration: pg_cron job for PAYG payment reminders
-- Runs hourly. The edge function decides per-rental whether a reminder is due
-- (based on grace period and per-rental interval) so any tenant timezone is supported.
-- Idempotent — safe to re-run.
-- The function has verify_jwt = false in config.toml so no auth header needed.
-- NOTE: Uses current_setting('app.settings.supabase_url') which resolves to the project URL at runtime.

CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";

-- Remove existing job if present (idempotent re-run)
DO $$
BEGIN
  PERFORM cron.unschedule('send-payg-reminders');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Schedule: every hour at :00
SELECT cron.schedule(
  'send-payg-reminders',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/send-payg-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
