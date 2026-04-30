-- Enable Realtime on the installment tables so the operator's InstallmentSection
-- and the customer's CustomerInstallmentsView pick up live updates from the
-- collection cron, BoldSign webhook, and operator actions without depending
-- on the polling fallback (which is gated on hasPending and never fires when
-- the cache is initially empty — same root-cause pattern that left
-- rental_agreements stuck on the empty state).
--
-- useInstallmentPlanRealtime subscribes to postgres_changes on:
--   - installment_plans          (filter: id=eq.<planId>)
--   - scheduled_installments     (filter: installment_plan_id=eq.<planId>)
--   - installment_notifications  (filter: installment_plan_id=eq.<planId>)
--
-- Without these tables in the supabase_realtime publication, the client
-- subscription connects fine but Postgres never publishes events, so
-- useInstallmentPlanRealtime's cache invalidations never fire.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'installment_plans'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.installment_plans;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'scheduled_installments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scheduled_installments;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'installment_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.installment_notifications;
  END IF;
END $$;
