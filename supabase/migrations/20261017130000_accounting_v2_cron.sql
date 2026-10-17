-- APPLIED to production 2026-10-17 (on go-ahead: "complete it")
--
-- Accounting sync v2 schedules.
--   accounting-sync-v2       every minute: sends waiting/due items (edge function)
--   accounting-v2-reconcile  hourly: the safety net — re-derives what the
--                            Finances tab shows for every connected tenant and
--                            queues anything missing or drifted (SQL, no network)
--
-- The worker's command is built from the existing customer-management-run job,
-- so the service-role key never sits in this repo.

DO $$
DECLARE
  v_cmd text;
BEGIN
  -- The worker runs for up to ~45s, so wait up to 55s for its answer.
  SELECT replace(replace(command, 'customer-management-run', 'accounting-sync-v2'),
                 'timeout_milliseconds := 25000', 'timeout_milliseconds := 55000')
    INTO v_cmd FROM cron.job WHERE jobname = 'customer-management-run';
  IF v_cmd IS NULL THEN
    RAISE EXCEPTION 'customer-management-run job not found — cannot build the accounting-sync-v2 command';
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'accounting-sync-v2';
  PERFORM cron.schedule('accounting-sync-v2', '* * * * *', v_cmd);

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'accounting-v2-reconcile';
  PERFORM cron.schedule('accounting-v2-reconcile', '7 * * * *', 'SELECT public.accounting_v2_reconcile();');
END $$;
