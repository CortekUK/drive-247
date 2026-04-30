-- Without REPLICA IDENTITY FULL, Postgres only emits the primary key in the
-- WAL old-record for UPDATEs. Supabase Realtime can't apply filtered
-- subscriptions (e.g. `rental_id=eq.<id>`) to UPDATE events when the filter
-- column isn't in the old record, so UPDATE events for these tables were
-- being silently dropped. That's why the operator's AgreementTimeline never
-- saw the BoldSign webhook flip document_status from 'sent' to 'completed',
-- and why InstallmentSection didn't react when the cron marked an
-- installment paid. INSERT events worked because they only carry the new row.
ALTER TABLE public.rental_agreements REPLICA IDENTITY FULL;
ALTER TABLE public.installment_plans REPLICA IDENTITY FULL;
ALTER TABLE public.scheduled_installments REPLICA IDENTITY FULL;
ALTER TABLE public.installment_notifications REPLICA IDENTITY FULL;
