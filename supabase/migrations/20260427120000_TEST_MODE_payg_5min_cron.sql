-- =============================================================================
-- TEST MODE: 5-minute PAYG cron cadence
-- =============================================================================
-- Bumps the two PAYG crons so they fire every minute instead of every 15 min /
-- hourly. Combined with the `5 * 60 * 1000` constants in:
--   - supabase/functions/accrue-payg-charges/index.ts
--   - supabase/functions/send-payg-reminders/index.ts
--   - apps/portal/src/hooks/use-payg-invoices.ts
-- this gives ~5-min accrual + ~5-min reminder cadence end-to-end.
--
-- TO REVERT FOR PRODUCTION:
--   1. Drop or replace this migration with one that re-runs the original
--      schedules from `20260415120000_fix_payg_audit_issues.sql`:
--        accrue-payg-charges  →  '*/15 * * * *'
--        send-payg-reminders  →  '0 * * * *'
--   2. Revert the `5 * 60 * 1000` constants in the three files above back to
--      `24 * 60 * 60 * 1000`.
--   3. Redeploy the two edge functions.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'accrue-payg-charges') THEN
    PERFORM cron.unschedule('accrue-payg-charges');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-payg-reminders') THEN
    PERFORM cron.unschedule('send-payg-reminders');
  END IF;
END $$;

SELECT cron.schedule(
  'accrue-payg-charges',
  '* * * * *',
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
  '* * * * *',
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
