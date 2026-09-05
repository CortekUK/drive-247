-- ============================================================================
-- 05-turo-sync-default.sql
--
-- THE SETTLED POSITION: Turo Sync is OPT-IN. `tenants.turo_bridge_enabled`
-- defaults to false, so no tenant -- existing or newly created -- gets the
-- feature until somebody switches it on in Settings -> General.
--
-- HOUSE RULE, same as 04: schema changes on this project go through the
-- Management API, NOT through a file in supabase/migrations/ that the CLI would
-- later replay. This file is the record of what was applied, not a migration.
-- Idempotent; safe to re-run.
--
-- ── HISTORY, because the column changed twice ───────────────────────────────
-- The default was briefly set to true so new tenants would start with the
-- feature available, then set back to false. Opt-in is the right shape: the
-- switch is not a cosmetic one. A tenant with it on has a "Turo Sync" entry in
-- their sidebar and any of their staff can point the extension at their
-- account, and that is a thing an operator should choose rather than discover.
--
-- The switch is enforced SERVER-SIDE, not just in the UI: turo-bridge-ingest
-- refuses a sync for a tenant with the flag off, with a 403 that says to turn
-- it on in Settings. Turning it off is therefore a real stop, not a hidden tab.
-- ============================================================================


-- ── 1. the default
, for tenants created from now on ─────────────────────────
ALTER TABLE public.tenants
  ALTER COLUMN turo_bridge_enabled SET DEFAULT false;


-- ── 2. existing tenants: DELIBERATELY UNTOUCHED ─────────────────────────────
-- APPLIED STATE, 2026-09-06: the default is false. No tenant row has ever been
-- changed by this file.
--
-- Four tenants have the flag on because somebody turned it on for them:
-- test, test-rent, test-rentals (development) and jangramrentals (its own
-- operator, through Settings). Those are deliberate choices and this file does
-- not undo them -- switching one off would stop a sync that is in use.
--
-- To enable one, name it explicitly. Never a blanket UPDATE: a WHERE clause
-- that matched more rows than intended is how dozens of businesses would find
-- a feature they never asked for sitting in their sidebar.
--
--   UPDATE public.tenants SET turo_bridge_enabled = true
--    WHERE slug IN ('some-tenant-slug');


-- ── 3. proof ────────────────────────────────────────────────────────────────
SELECT
  (SELECT column_default
     FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'tenants'
      AND column_name  = 'turo_bridge_enabled')          AS new_default,
  count(*) FILTER (WHERE turo_bridge_enabled)            AS enabled_tenants,
  count(*) FILTER (WHERE NOT turo_bridge_enabled)        AS disabled_tenants
FROM public.tenants;


-- ============================================================================
-- NEVER RUN THIS. Written down once, correctly, so that nobody improvises it:
--
--   UPDATE public.tenants SET turo_bridge_enabled = true;
--
-- It would give every rental business on the platform a "Turo Sync" entry in
-- their sidebar and open their account to a sync they did not ask for. Nothing
-- would import without a further action -- promotion still needs an exact
-- plate match -- but the queue would start filling in accounts whose owners
-- were never told the feature existed.
-- ============================================================================
