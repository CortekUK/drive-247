-- Add payment-related tables to the supabase_realtime publication so the
-- admin and customer rental pages get postgres_changes events when a Stripe
-- webhook applies a payment or admin approves an extension. Without this,
-- the page subscriptions are no-ops and stat cards (Balance Due, Collected,
-- Refunded) stay stale until a manual refresh.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'ledger_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ledger_entries;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'payment_applications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_applications;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'rental_extensions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rental_extensions;
  END IF;
END $$;
