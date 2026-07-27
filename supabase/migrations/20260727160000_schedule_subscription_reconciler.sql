-- Schedule the subscription reconciler (requirement C5: "no discrepancies").
--
-- Webhooks are a DELIVERY guarantee, not a CONSISTENCY guarantee. Anything
-- missed while an endpoint is down, disabled, or crashing stays wrong forever —
-- which is exactly what happened: handleSubscriptionUpdated threw RangeError on
-- every customer.subscription.updated for ~7 days and the DB silently froze,
-- leaving 9 tenants marked canceled who were actually active and one marked
-- trialing who was actually past_due.
--
-- reconcile-subscriptions repairs that drift from Stripe. Until it is scheduled
-- it only runs when an engineer invokes it by hand, so "the dashboard matches
-- Stripe" is true only immediately after someone remembers to run it.
--
-- Cadence: hourly, not every 5 minutes. Subscriptions change on the order of
-- days; the webhook already covers real time. Hourly bounds worst-case drift to
-- an hour while staying far inside Stripe's rate limits (it lists across all
-- four account x mode cells on every run).
--
-- Minute 17 rather than 0 keeps it off the same tick as the other jobs.
--
-- The Authorization header is copied from the existing accrue-payg-charges job
-- rather than re-embedding the service_role key here, so the secret is never
-- written into a migration file in source control.

SELECT cron.schedule(
  'reconcile-subscriptions',
  '17 * * * *',
  replace(
    replace(s.cmd, 'accrue-payg-charges', 'reconcile-subscriptions'),
    'body := ''{}''::jsonb',
    'body := ''{"dryRun":false}''::jsonb'
  )
)
FROM (
  SELECT command AS cmd FROM cron.job WHERE jobname = 'accrue-payg-charges'
) s;

-- Verify:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'reconcile-subscriptions';
--   SELECT status, start_time, return_message FROM cron.job_run_details
--     WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'reconcile-subscriptions')
--     ORDER BY start_time DESC LIMIT 5;
--
-- Rollback:
--   SELECT cron.unschedule('reconcile-subscriptions');
