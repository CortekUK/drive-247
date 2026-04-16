-- Migration: Fix PAYG audit issues
-- 1. Create missing increment_payg_reminder_count RPC (atomic counter)
-- 2. Re-schedule cron jobs with Authorization header (service_role key)
-- 3. Add unique partial index on ledger_entries.reference for PAYG charges

-- ============================================================================
-- 1. MISSING RPC: increment_payg_reminder_count
-- The send-payg-reminders edge function calls this RPC for atomic increment.
-- Without it, every call falls back to a racy read-then-write direct update.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.increment_payg_reminder_count(
  p_rental_id uuid,
  p_last_sent_at timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.rentals
  SET payg_reminder_count = payg_reminder_count + 1,
      payg_last_reminder_sent_at = p_last_sent_at
  WHERE id = p_rental_id;
$$;

COMMENT ON FUNCTION public.increment_payg_reminder_count IS
  'Atomically increments payg_reminder_count and stamps payg_last_reminder_sent_at. Used by send-payg-reminders cron to avoid read-then-write race conditions.';

-- Grant execute to service_role (edge functions) and authenticated (fallback)
GRANT EXECUTE ON FUNCTION public.increment_payg_reminder_count TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_payg_reminder_count TO authenticated;

-- ============================================================================
-- 2. RE-SCHEDULE CRON JOBS WITH AUTH HEADER
-- Previous cron jobs sent no Authorization header, meaning the endpoints
-- were callable by anyone who knew the Supabase project URL.
-- Now we pass the service_role key so the functions can optionally verify it.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";

-- Unschedule existing jobs
DO $$
BEGIN
  PERFORM cron.unschedule('accrue-payg-charges');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('send-payg-reminders');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Re-schedule with Authorization header
SELECT cron.schedule(
  'accrue-payg-charges',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/accrue-payg-charges',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'send-payg-reminders',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/send-payg-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================================
-- 3. UNIQUE PARTIAL INDEX ON LEDGER REFERENCE FOR PAYG CHARGES
-- Prevents duplicate Charge entries if accrual rollback fails mid-way.
-- Only covers PAYG references (payg-*) to avoid impacting other charge flows.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS "ux_ledger_payg_charge_reference"
  ON "public"."ledger_entries" ("reference")
  WHERE "reference" IS NOT NULL
    AND "reference" LIKE 'payg-%'
    AND "type" = 'Charge';

COMMENT ON INDEX "public"."ux_ledger_payg_charge_reference" IS
  'Ensures idempotent PAYG charge ledger entries — prevents duplicate charges if accrual rollback fails.';
