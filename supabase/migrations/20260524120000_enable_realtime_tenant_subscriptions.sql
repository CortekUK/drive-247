-- Enable Realtime on tenant_subscriptions so the portal Finish Setup / Block
-- Screen gate reacts immediately to Stripe webhook updates instead of waiting
-- for a page refresh.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tenant_subscriptions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_subscriptions;
  END IF;
END $$;
