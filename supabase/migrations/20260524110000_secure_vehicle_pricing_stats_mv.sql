-- Revenue Optimiser — close cross-tenant leak on the MV (Spec §9.3).
--
-- Postgres materialised views can't have RLS, so the previous GRANT SELECT
-- to `authenticated` was leaking every tenant's stats to every authenticated
-- user. Edge functions are the only legitimate readers (they query as
-- service_role); revoke from authenticated.
--
-- Anything client-side that needs stats reads them via an edge fn that
-- enforces tenant scoping in code.
REVOKE SELECT ON public.vehicle_pricing_stats FROM authenticated;
-- service_role already had it; redundant but explicit
GRANT SELECT ON public.vehicle_pricing_stats TO service_role;

COMMENT ON MATERIALIZED VIEW public.vehicle_pricing_stats IS
  'Per-vehicle pricing/demand/supply metrics. Refreshed hourly via pg_cron. Spec §9.2. '
  'Edge-function only — `authenticated` role has no SELECT to prevent cross-tenant leakage.';
