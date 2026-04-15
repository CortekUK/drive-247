-- Migration: pg_cron job for PAYG daily accrual
-- Runs every 15 minutes. Idempotent — safe to re-run.
-- The edge function itself uses a unique constraint on (rental_id, accrual_day_index)
-- so concurrent or re-triggered runs cannot double-post ledger entries.
-- The function has verify_jwt = false in config.toml so no auth header needed.

CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";

-- Remove existing job if present (idempotent re-run)
DO $$
BEGIN
  PERFORM cron.unschedule('accrue-payg-charges');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Schedule: every 15 minutes
SELECT cron.schedule(
  'accrue-payg-charges',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/accrue-payg-charges',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
