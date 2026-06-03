-- Daily nudge cron for unpaid auto-extension pay-links.
-- The edge function (empty body) sweeps auto-extend rentals in 'awaiting_payment'
-- whose last reminder is older than the per-rental interval and re-sends the link,
-- respecting auto_extend_reminder_max. Manual sends use the same function with a body.

DO $$ BEGIN PERFORM cron.unschedule('send-auto-extension-reminders'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'send-auto-extension-reminders',
  '0 14 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/send-auto-extension-reminder',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
