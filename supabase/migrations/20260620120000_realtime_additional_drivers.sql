-- The additional-drivers card subscribes to realtime updates so verification /
-- signing badges flip live when the Veriff/BoldSign webhooks land. The table was
-- never added to the supabase_realtime publication, so those updates never fired
-- (the card only refreshed on page load). Add it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rental_additional_drivers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rental_additional_drivers;
  END IF;
END $$;
