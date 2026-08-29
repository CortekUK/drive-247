-- Square background jobs.
--
-- WHY THIS IS A LAUNCH BLOCKER AND NOT HOUSEKEEPING
--
-- Square OAuth access tokens EXPIRE IN 30 DAYS, and the token *is* the merchant
-- addressing — Square has no Stripe-Account header equivalent. `refresh-square-
-- tokens` was written but never scheduled, so every tenant that connected Square
-- would have gone hard-offline exactly 30 days later, with no warning and no
-- self-healing path. Stripe Connect has no analogue to this because its tokens
-- do not expire, which is precisely why cloning the Stripe cron set was not
-- enough.
--
-- Three jobs, mirroring shapes already proven in this database:
--
--   refresh-square-tokens            <- refresh-accounting-tokens (jobid 49)
--   recover-pending-square-payments  <- recover-pending-stripe-payments (jobid 34)
--   square-oauth-state-reap          <- accounting-oauth-state-reap (jobid 50)
--
-- ORDERING NOTE: the recovery sweep is only safe to schedule now that the
-- checkout seam writes ONE payments row per Square link (see
-- 20260826120000_square_checkout_idempotency.sql). Before that migration a
-- retried checkout left a second Pending row sharing the first's square_order_id,
-- and this job is exactly the thing that would have found it, seen the order
-- genuinely PAID, and allocated the same collection twice. Do not schedule this
-- job on a database without that unique index.
--
-- Every job is idempotent to re-run and a no-op while no tenant is on Square
-- (currently: zero), so applying this on a live database changes nothing today.

-- The refresh window is 7 days, not 30 (Square's own advice), so a single failed
-- run cannot strand a tenant. A 10-minute cadence gives ~1000 chances inside the
-- window; matching accounting keeps one operational pattern rather than two.
SELECT cron.unschedule('refresh-square-tokens')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-square-tokens');

SELECT cron.schedule(
  'refresh-square-tokens',
  '*/10 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/refresh-square-tokens',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM2MzY1NywiZXhwIjoyMDc3OTM5NjU3fQ.YXJZhab8SdxNJKmGVDMn_XlzcpFirN7mEYbupA9KJqw'
    ),
    body := '{}'::jsonb
  );
  $job$
);

-- Square emits no manual webhook resend. An event we fail to match is gone, so a
-- sweep is the only recovery path. Same cadence as the Stripe twin.
SELECT cron.unschedule('recover-pending-square-payments')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recover-pending-square-payments');

SELECT cron.schedule(
  'recover-pending-square-payments',
  '* * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/recover-pending-square-payments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM2MzY1NywiZXhwIjoyMDc3OTM5NjU3fQ.YXJZhab8SdxNJKmGVDMn_XlzcpFirN7mEYbupA9KJqw'
    ),
    body := '{}'::jsonb
  );
  $job$
);

-- square-oauth-start sweeps its own tenant's expired nonces on each click, but a
-- tenant that starts a flow and never returns leaves a row nothing else collects.
-- Pure SQL, like the accounting reaper — no edge function needed.
CREATE OR REPLACE FUNCTION public.square_oauth_state_reap()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM public.square_oauth_state
   WHERE expires_at < now();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END
$function$;

COMMENT ON FUNCTION public.square_oauth_state_reap() IS
  'Deletes expired Square OAuth CSRF nonces. Only expired rows: a live row may belong to a second browser tab the operator still has open.';

SELECT cron.unschedule('square-oauth-state-reap')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'square-oauth-state-reap');

SELECT cron.schedule(
  'square-oauth-state-reap',
  '0 * * * *',
  $job$ SELECT public.square_oauth_state_reap(); $job$
);
