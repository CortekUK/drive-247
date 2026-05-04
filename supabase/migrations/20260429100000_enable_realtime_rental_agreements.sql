-- Enable Realtime on rental_agreements so the portal's AgreementTimeline
-- can subscribe to live INSERT/UPDATE events and keep its cache in sync
-- without depending on polling-based refetch (which loses transient state).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'rental_agreements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rental_agreements;
  END IF;
END $$;
