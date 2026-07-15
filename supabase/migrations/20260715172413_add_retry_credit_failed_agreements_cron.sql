-- Migration: hourly sweep for credit_failed rental agreements
--
-- Safety net behind the primary trigger (subscription-webhook auto-retries right
-- after a live credit top-up). This hourly sweep catches any tenant whose wallet
-- was topped up out-of-band (super-admin gift/adjust, auto-refill) so parked
-- agreements (document_status='credit_failed') on still-Active rentals get
-- regenerated without waiting for the next checkout webhook.
--
-- The edge function is idempotent — it skips rentals already covered by a valid
-- agreement and, in live mode, skips wallets that still can't cover one agreement,
-- so re-running is harmless. verify_jwt = false in config.toml (no auth header).

-- pg_net for HTTP calls from pg_cron
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";

-- Idempotent re-run: drop existing job if present
DO $$
BEGIN
  PERFORM cron.unschedule('retry-credit-failed-agreements');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Schedule: hourly, sweep every tenant (empty body → all tenants)
SELECT cron.schedule(
  'retry-credit-failed-agreements',
  '30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/retry-credit-failed-agreements',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
