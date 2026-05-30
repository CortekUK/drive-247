-- pg_cron job for auto-extension rentals.
-- Runs every 15 minutes; the edge function is idempotent (acts only when
-- auto_extend_next_charge_at <= now and advances the pointer in the same write).

CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";

-- Remove existing job if present (idempotent re-run)
DO $$
BEGIN
  PERFORM cron.unschedule('auto-extend-rentals');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'auto-extend-rentals',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/auto-extend-rentals',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
