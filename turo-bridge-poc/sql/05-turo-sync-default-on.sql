-- ============================================================================
-- 05-turo-sync-default-on.sql
--
-- Flips the DEFAULT of `public.tenants.turo_bridge_enabled` from false to true,
-- and switches the flag on for the tenants named in step 2.
--
-- HOUSE RULE, same as 04: schema changes on this project go through the
-- Management API, NOT through a file in supabase/migrations/ that the CLI would
-- later replay. This file is the record of what was applied, not a migration.
-- Idempotent; safe to re-run.
--
-- ── WHY THE DEFAULT CHANGES ─────────────────────────────────────────────────
-- The flag was introduced fail-closed, which was right while the feature could
-- still write badly. It no longer can: turo-bridge-ingest resolves the tenant
-- from the credential and never from the body, promote refuses fixtures, and a
-- non-authoritative read releases nothing. What the OFF default buys today is
-- one 403 in the middle of a first sync, at the exact moment somebody is
-- deciding whether this feature works at all.
--
-- The switch itself stays, and stays enforced server-side. A tenant who turns
-- it off is still refused by turo-bridge-ingest with the same 403; the change
-- is only which way a tenant starts.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
-- It does not switch on the 59 existing tenants who have it off. Every one of
-- them is a live rental business that never asked for this, and turning it on
-- would put a "Turo Sync" entry in their sidebar and open their account to a
-- sync they did not request. A DEFAULT applies to rows created from now on;
-- changing 59 existing rows is a product decision, not a schema one, and it
-- belongs to whoever owns the product rather than to this script.
--
-- If that decision is ever made, it is one statement, and it is written out at
-- the bottom of this file COMMENTED OUT so that running this file cannot
-- perform it by accident.
-- ============================================================================


-- ── 1. the default, for tenants created from now on ─────────────────────────
ALTER TABLE public.tenants
  ALTER COLUMN turo_bridge_enabled SET DEFAULT true;


-- ── 2. the tenants this was applied for ─────────────────────────────────────
-- Named one at a time and never as a blanket UPDATE. A WHERE clause that
-- matched more rows than intended is how 59 businesses would find a feature
-- they never asked for switched on in their sidebar.
UPDATE public.tenants
   SET turo_bridge_enabled = true
 WHERE slug IN ('jangramrentals');


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
-- NOT RUN. Left here so the statement is written down once, correctly, rather
-- than improvised under pressure by whoever needs it next.
--
--   UPDATE public.tenants SET turo_bridge_enabled = true;
--
-- Before running it, be able to answer: every tenant gains a "Turo Sync" entry
-- in their sidebar, and any of their staff who installs the extension can sync
-- Turo trips into their account. Nothing is imported without a further,
-- separate action -- promotion still needs an exact plate match or a human --
-- but the queue starts filling.
-- ============================================================================
