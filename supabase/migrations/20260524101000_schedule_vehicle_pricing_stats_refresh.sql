-- Revenue Optimiser — schedule hourly MV refresh via pg_cron.
-- The CONCURRENTLY refresh requires the UNIQUE INDEX on vehicle_id (created in
-- the previous migration), so reads against the MV are never blocked during refresh.
SELECT cron.schedule(
  'revenue-optimiser-refresh-vehicle-pricing-stats',
  '5 * * * *',  -- every hour at minute :05 (avoids the on-the-hour cron pile-up)
  $$ REFRESH MATERIALIZED VIEW CONCURRENTLY public.vehicle_pricing_stats; $$
);

COMMENT ON EXTENSION pg_cron IS 'Cron jobs in Supabase';  -- harmless; just documents we're using it
