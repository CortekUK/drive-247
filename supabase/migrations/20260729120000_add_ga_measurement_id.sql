-- =============================================================================
-- Per-tenant Google tag (GA4 / Google Analytics measurement ID)
--
-- Lets an operator paste their own Google tag ID (e.g. G-BQ0W52VG1R) in the
-- portal; the booking site then loads gtag.js for that tenant, which lights up
-- the gtag('event', ...) calls already sprinkled through the booking flow (they
-- are no-ops today because nothing ever loads the base script). This is what an
-- operator needs to measure a Google Ads campaign against actual bookings.
-- =============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS ga_measurement_id text;

COMMENT ON COLUMN public.tenants.ga_measurement_id IS
  'Google tag / GA4 measurement ID (e.g. G-XXXXXXXXXX) injected into the booking site <head>. Null = analytics off.';

-- CRITICAL: the booking site reads tenants with the ANON key, and a prior
-- migration (20260723090000_lock_down_tenants_rls.sql) revoked anon's
-- table-level SELECT and re-granted only an explicit allow-list of non-secret
-- columns. A new column is therefore UNREADABLE to anon until it is added to
-- that allow-list — without this grant the tag would silently never load.
-- ga_measurement_id is a public analytics id (it already ships in the page
-- source of any site that uses it), so exposing it to anon is safe.
GRANT SELECT (ga_measurement_id) ON public.tenants TO anon;
