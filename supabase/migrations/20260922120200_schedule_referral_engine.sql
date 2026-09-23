-- ============================================================================
-- Drive247 referral programme — run the referral engine every 15 minutes.
--
-- The engine (supabase/functions/referral-engine) keeps every referrer's tier
-- reward on their subscription in step with how many of their referrals are
-- still subscribed. It is idempotent and holds a run lease, so an overlapping
-- or repeated call changes nothing.
--
-- The command is COPIED from the existing `reconcile-subscriptions` job and the
-- function name and body swapped, exactly as that job was itself derived from
-- `accrue-payg-charges` (20260727160000). That way the project URL and the
-- service-role bearer come from the job this project already runs, and no
-- secret is ever written into a migration.
--
-- Schedule on PRODUCTION only. Do not copy this job into a staging project that
-- holds production secrets: it would call production from staging.
--
-- Apply after the function is deployed. NEVER `supabase db push`.
-- ============================================================================

SELECT cron.schedule(
  'referral-engine',
  '*/15 * * * *',
  replace(
    replace(s.cmd, 'reconcile-subscriptions', 'referral-engine'),
    'body := ''{"dryRun":false}''::jsonb',
    'body := ''{}''::jsonb'
  )
)
FROM (
  SELECT command AS cmd FROM cron.job WHERE jobname = 'reconcile-subscriptions'
) s;

-- The copy above schedules nothing when the source job is missing, and would
-- do so silently. Fail loudly instead, so it is never mistaken for scheduled.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'referral-engine') THEN
    RAISE EXCEPTION 'referral-engine was not scheduled: the reconcile-subscriptions job it is copied from does not exist in this project';
  END IF;
END $$;

-- Verify:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'referral-engine';
--
-- Rollback:
--   SELECT cron.unschedule('referral-engine');
