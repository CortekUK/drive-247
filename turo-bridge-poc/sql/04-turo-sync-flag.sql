-- ============================================================================
-- 04-turo-sync-flag.sql
--
-- Makes `public.tenants.turo_bridge_enabled` safe to read from the portal's
-- tenant query, and makes sure no tenant who already has Turo data loses sight
-- of it the moment the screen goes behind the flag.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> paste -> Run, or mcp__supabase__apply_migration.
--   House rule on this project: schema changes go through the Management API,
--   NOT through a file in supabase/migrations/ that the CLI would later replay.
--   This file is the script, not a migration. Idempotent; safe to re-run.
--
--   NOT APPLIED by the agent that wrote it. A human applies it.
--
-- ⚠ SUPERSEDED two earlier drafts (04-turo-bridge-enabled-grant.sql and
--   04-turo-sync-flag-grant.sql). Both have been DELETED -- three files
--   numbered 04 was a coin-flip for whoever came next, and only this one
--   carries both the to_regclass guard and the step-4 backfill that switches
--   on the tenants which already hold synced trips. This is now the only 04.
--
-- ORDER OF OPERATIONS
--   An earlier draft of this header said the order was non-negotiable and that
--   getting it wrong took all 63 tenants down. That WAS true of the frontend as
--   first written. It is not true of the frontend as merged, and pretending
--   otherwise makes the next person distrust the rest of this file.
--
--   `turo_bridge_enabled` is in TENANT_OPTIONAL_COLUMNS, not TENANT_CORE_COLUMNS
--   (apps/portal/src/contexts/TenantContext.tsx:174, committed at 8632311d), and
--   the retry ladder there sheds it. So the ungranted case degrades instead of
--   failing: the flag reads undefined, undefined reads as OFF, the feature hides
--   itself. Fail-closed, no outage, either order.
--
--   ⚠ DO NOT "TIDY" THIS COLUMN INTO TENANT_CORE_COLUMNS. That single edit is
--   the one that genuinely breaks branding AND login for all 63 tenants at once,
--   because every rung of the ladder keeps the core list and there is no rung
--   below it. If it ever must move there, this grant has to be applied and
--   PROVEN with a real anon-key read first.
--
--   RUN IT AS THREE SEPARATE REQUESTS, not one paste. The Management API
--   endpoint returns only the LAST NON-EMPTY result set, and RAISE NOTICE is
--   swallowed entirely -- so a whole-file paste hides the VERIFY numbers behind
--   the DEPLOY GATE exactly when the gate has something to say.
--     1. The transaction (BEGIN ... COMMIT).
--     2. VERIFY.
--     3. DEPLOY GATE.
--   Then the anon smoke test over HTTP. A green typecheck gates nothing here;
--   only the anon-key read does.
--
--   PRODUCTION IS THE ONLY DATABASE THAT NEEDS THIS. Measured on the staging
--   branch database (ksmreaadhbirzakkxqrq) 2026-09-05: `anon` there holds
--   TABLE-level SELECT on public.tenants, so the GRANT is a no-op; the column
--   and public.turo_bridge_reservations do not exist; and `integration_veriff`
--   -- a CORE column -- is missing, so no tenant resolves on staging at all,
--   grant or no grant. Staging is also a non-persistent branch, so anything
--   hand-applied there is discarded on the next reset. Do not treat a green
--   smoke test against staging as evidence of anything.
--
-- VERIFIED AGAINST LIVE PRODUCTION (hviqoaokxvlancmftwuo) 2026-09-05:
--   public.tenants ......................... 270 columns
--   anon TABLE-level grants on tenants ....... 0
--   anon COLUMN-level SELECT grants .........  242
--   anon grant on turo_bridge_enabled .......   0   <-- the landmine
--   authenticated table-level SELECT ........   1   (so it needs nothing)
--   tenants total ...........................  63
--   tenants with turo_bridge_enabled = true ..  0
--   turo_bridge_reservations ................ 10 rows across 2 tenants
--     test-rent  9 rows, last sync 2026-09-04
--     test       1 row,  last sync 2026-08-31
-- ============================================================================


BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Do not queue an ACCESS EXCLUSIVE lock on `tenants` behind a slow reader.
--
-- ALTER TABLE picks its lock level from the parsed subcommand BEFORE the
-- IF NOT EXISTS check runs, so statement 1 takes ACCESS EXCLUSIVE on
-- public.tenants even though it is a metadata no-op on production -- and
-- BEGIN..COMMIT holds it until the end. Every booking site and every portal
-- login reads this table, so a wait here is a platform-wide stall.
--
-- Measured on the applying session 2026-09-05: lock_timeout = '0' (wait
-- forever) and statement_timeout = '2min'. Without this line a contended apply
-- stalls every reader for up to two minutes -- the same outage this file exists
-- to prevent, caused by the fix. With it, a contended apply fails clean in 3s
-- with 55P03, rolls the whole transaction back, and you re-run when it is quiet.
-- Costs nothing when the table is idle, which is the normal case.
-- ---------------------------------------------------------------------------
SET LOCAL lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1. The column.
--
-- Already present in production as boolean NOT NULL DEFAULT false, so this is
-- a no-op there. It exists so staging, branch databases and any fresh copy end
-- up with the same shape rather than failing at step 3 below.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS turo_bridge_enabled boolean NOT NULL DEFAULT false;


-- ---------------------------------------------------------------------------
-- 2. THE GRANT. This is the load-bearing line in this file. DO NOT DELETE IT
--    AS REDUNDANT -- it is not redundant, and the failure it prevents is total.
--
-- ⚠ WHY, MECHANICALLY:
--
--   Postgres column privileges are evaluated per STATEMENT, all-or-nothing. If
--   a SELECT names even ONE column the current role may not read, Postgres
--   REFUSES THE ENTIRE ROW with error 42501. It does NOT return NULL for that
--   column and hand back the rest. The caller does not get a tenant with one
--   field missing, it gets no tenant at all.
--
--   MEASURED ON PRODUCTION 2026-09-05 with the anon key, not inferred:
--     select=id,slug                        -> HTTP 200, row returned
--     select=id,slug,turo_bridge_enabled    -> HTTP 401
--       {"code":"42501","message":"permission denied for table tenants"}
--   Note BOTH details, because they are what makes this expensive to diagnose:
--   the status is 401 (reads as an AUTH problem, not a permissions one), and
--   the body says "table tenants" -- it NEVER names the offending column.
--
--   `public.tenants` is granted to `anon` COLUMN BY COLUMN -- 242 individual
--   column grants and ZERO table-level grants (see
--   20260723090000_lock_down_tenants_rls.sql). Every column added to a select
--   list on the anon path is therefore opt-in, and silence is refusal.
--
--   Both the booking site AND the portal's own login page resolve their tenant
--   with the ANON key, before any session exists. So a column that joins
--   TENANT_CORE_COLUMNS without this grant takes EVERY tenant's booking site
--   down to default branding and strips EVERY portal login page of its logo --
--   simultaneously, for all 63 tenants.
--
--   It presents as a CDN or branding bug, not a permissions bug, which is what
--   makes it expensive: it burns hours before anyone suspects a GRANT. This
--   exact failure has already happened once on this project, with
--   `customer_theme_mode`.
--
--   AND THERE IS NO SAFETY NET LEFT. TenantContext.tsx carries a 42501 retry,
--   but it retries with TENANT_CORE_COLUMNS only -- i.e. it can shed the INSHUR
--   columns and nothing else. A column added to the CORE list with no grant
--   fails the query and then fails the retry identically.
--
--   AND THAT RETRY IS ALREADY BEING SPENT ON EVERY SINGLE PAGE LOAD TODAY.
--   Measured on production 2026-09-05: anon holds ZERO grants on all seven
--   INSHUR columns, so attempt 1 (CORE + INSHUR) 401s for every tenant, every
--   time, and the portal only renders because attempt 2 (CORE alone) succeeds.
--   That is pre-existing and out of scope here, but it is the reason this file
--   is not optional: the fallback is not in reserve, it is in use.
--
--   ⚠ WHAT THIS FILE IS *NOT*: A SHIP BLOCKER. An earlier draft of the frontend
--   put turo_bridge_enabled in TENANT_CORE_COLUMNS, which would have made
--   applying this file a hard prerequisite for merging. It does not any more --
--   the flag sits in TENANT_OPTIONAL_COLUMNS and the retry ladder in
--   TenantContext.tsx grew a middle rung, so the ungranted case now degrades:
--     attempt 1  CORE + INSHUR + turo  -> 401  (INSHUR is ungranted for anon)
--     attempt 2  CORE + turo           -> 401  (until this file runs)
--     attempt 3  CORE                  -> 200  portal renders, flag undefined
--   Undefined reads as OFF, so the feature hides itself. Fail-closed, no outage.
--
--   THE GRANT STILL MATTERS, for a subtler reason. TenantContext fetches ONCE
--   on mount with `[]` deps and never refetches on auth change, and signing in
--   navigates with router.replace() -- which keeps the root layout, and so this
--   provider, mounted. The tenant object built ANONYMOUSLY on the login page is
--   therefore what the authenticated dashboard uses for the rest of the
--   session. Without this grant, an operator who has Turo Sync switched ON sees
--   no sidebar entry after signing in, and it only appears on their next hard
--   refresh. That reads as a broken toggle, which is the bug this file closes.
--
-- WHAT IT LEAKS: nothing. This is one boolean saying whether an operator's own
-- portal shows a Turo Sync entry in its sidebar. It gates no data. The Turo
-- rows themselves stay behind RLS on turo_bridge_reservations, which is scoped
-- to `authenticated` and `tenant_id = get_user_tenant_id() OR is_super_admin()`.
-- ---------------------------------------------------------------------------
GRANT SELECT (turo_bridge_enabled) ON public.tenants TO anon;

-- `authenticated` currently holds table-level SELECT on tenants, so this line
-- is belt-and-braces rather than strictly required today. It is here because
-- the table has been through one lock-down pass already; if a future pass
-- replaces the table grant with column grants the way it did for anon, this
-- column will not be the one that gets forgotten.
GRANT SELECT (turo_bridge_enabled) ON public.tenants TO authenticated;


-- ---------------------------------------------------------------------------
-- 3. Document the trap on the column itself, so the next person adding a
--    column to TENANT_CORE_COLUMNS finds it without reading this file.
--
-- ⚠ THIS OVERWRITES A COMMENT THAT RECORDED THE OPPOSITE DECISION, and
-- COMMENT ON keeps no history. The text being replaced, read off the live
-- column 2026-09-05 and preserved here so the reversal is not silent:
--
--   'Gates turo-bridge-promote. Deliberately NOT granted to anon: anon has
--    column-level grants on tenants and an ungranted column 403s the entire
--    booking-side query.'
--
-- That decision was right about the mechanism and wrong about the conclusion:
-- withholding the grant does not avoid the 403, it just moves the column out of
-- the query -- and the portal then cannot see its own flag. The new text says
-- so, and keeps the half the old comment got right: the flag DOES gate
-- turo-bridge-promote at the application layer.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.tenants.turo_bridge_enabled IS
  'Feature flag: when true this tenant''s portal shows the Turo Sync screen and '
  'its sidebar entry. Default false. Read on the ANON path via '
  'TENANT_OPTIONAL_COLUMNS in apps/portal/src/contexts/TenantContext.tsx, which '
  'is shed by the 42501 retry when ungranted -- so a missing grant here hides '
  'the feature rather than breaking the portal. It still needs the column-level '
  'GRANT SELECT to anon applied by turo-bridge-poc/sql/04-turo-sync-flag.sql, '
  'because the tenant row is fetched once (on the anonymous login page) and '
  'reused all session, so an ungranted flag stays undefined in the dashboard '
  'until a hard refresh. Promoting this column into TENANT_CORE_COLUMNS without '
  'the grant is the version that DOES break every tenant at once: Postgres '
  'refuses the WHOLE ROW (42501), not just the column. This is a visibility '
  'preference at the DATABASE layer -- verified 2026-09-05: it appears in no RLS '
  'policy, no view and no function, and the Turo rows are fenced by RLS on '
  'turo_bridge_reservations. It IS an application-level gate: '
  'supabase/functions/turo-bridge-promote/index.ts returns 403 when it is false. '
  'Supersedes an earlier comment reading "Deliberately NOT granted to anon"; '
  'that decision was reconsidered 2026-09-05 because withholding the grant does '
  'not avoid the 42501, it only hides the flag from the portal that owns it.';


-- ---------------------------------------------------------------------------
-- 4. Do not hide data that already exists.
--
-- The flag defaults to false, so putting the screen behind it would strand any
-- tenant who has already synced trips: their rows stay in the database but the
-- only screen that renders them disappears. Turn the flag ON wherever there is
-- something to show.
--
-- The rule this encodes: THE FLAG HIDES AN EMPTY PAGE, NEVER POPULATED DATA.
--
-- Today that is 2 tenants and both are fixtures (test-rent, test), so nobody
-- real is affected -- but this runs anyway, because the correctness of the rule
-- must not depend on that still being true whenever someone gets round to
-- applying this.
--
-- After rollout the operator can of course switch it off with rows present.
-- That is their choice and it destroys nothing; the toggle copy and the
-- off-state screen both say so.
--
-- WHICH IS EXACTLY WHY THE BACKFILL IS ONE-SHOT. A plain re-run of an
-- "idempotent" backfill would quietly switch the flag back ON for an operator
-- who had deliberately switched it off -- the statement is idempotent, but its
-- EFFECT is not, and it would be overriding a human decision. So it is skipped
-- once any tenant has the flag on, i.e. once the rollout has visibly happened.
-- Before rollout: 0 tenants enabled -> it runs. After: it never runs again.
--
-- Guarded on the table existing: the PoC tables are applied per-database, and
-- this file must not fail on a staging copy that has the tenants column but
-- not the reservations table.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  touched integer := 0;
BEGIN
  IF to_regclass('public.turo_bridge_reservations') IS NULL THEN
    RAISE NOTICE 'turo_bridge_reservations does not exist here; skipping backfill.';
    RETURN;
  END IF;

  -- One-shot guard -- see the note above. Rollout has already happened, so any
  -- tenant sitting at false is sitting there on purpose. Leave it alone.
  IF EXISTS (SELECT 1 FROM public.tenants WHERE turo_bridge_enabled) THEN
    RAISE NOTICE 'Rollout already happened (>=1 tenant enabled); leaving every flag as the operators set it.';
    RETURN;
  END IF;

  UPDATE public.tenants t
     SET turo_bridge_enabled = true
   WHERE t.turo_bridge_enabled IS DISTINCT FROM true
     AND EXISTS (
           SELECT 1
             FROM public.turo_bridge_reservations r
            WHERE r.tenant_id = t.id
         );

  GET DIAGNOSTICS touched = ROW_COUNT;
  RAISE NOTICE 'Enabled Turo Sync for % tenant(s) that already hold synced trips.', touched;
END
$$;

COMMIT;


-- ============================================================================
-- VERIFY -- expect anon_grant = 1 and stranded_tenants = 0.
--
-- `anon_grant` is the discriminating number: it reads 0 before this file is
-- applied and 1 after. Confirmed 0 on production 2026-09-05.
--
-- `authenticated_grant` is informational ONLY. It already reads 1 without this
-- file, because information_schema.column_privileges expands a TABLE-level
-- grant into one row per column and `authenticated` holds table-level SELECT.
-- Do not read it as proof the GRANT statements above ran.
-- ============================================================================
SELECT
  (SELECT count(*)
     FROM information_schema.column_privileges
    WHERE table_schema   = 'public'
      AND table_name     = 'tenants'
      AND grantee        = 'anon'
      AND column_name    = 'turo_bridge_enabled'
      AND privilege_type = 'SELECT')                     AS anon_grant,
  (SELECT count(*)
     FROM information_schema.column_privileges
    WHERE table_schema   = 'public'
      AND table_name     = 'tenants'
      AND grantee        = 'authenticated'
      AND column_name    = 'turo_bridge_enabled'
      AND privilege_type = 'SELECT')                     AS authenticated_grant,
  (SELECT count(*) FROM public.tenants)                  AS tenants_total,
  (SELECT count(*) FROM public.tenants
    WHERE turo_bridge_enabled)                           AS tenants_enabled,
  -- Which tenants ended up switched on. A bare count is not attributable; if a
  -- slug other than the ones you expected appears here, STOP.
  (SELECT string_agg(slug, ', ' ORDER BY slug)
     FROM public.tenants WHERE turo_bridge_enabled)      AS enabled_slugs,
  -- Any tenant holding Turo rows while the flag is off. MUST be 0.
  --
  -- ⚠ NO to_regclass GUARD HERE, because it does not work in this position and
  -- pretending it does is worse than omitting it. The planner resolves
  -- public.turo_bridge_reservations before the runtime condition is ever
  -- evaluated, so on a database lacking the table this errors 42P01 rather than
  -- short-circuiting -- reproduced on staging 2026-09-05. (The identical-looking
  -- guard inside the DO block above IS effective: PL/pgSQL plans lazily and
  -- RETURNs first. The two are not equivalent despite reading the same.)
  -- On a database without the table, delete this subquery instead.
  (SELECT count(*)
     FROM public.tenants t
    WHERE t.turo_bridge_enabled IS DISTINCT FROM true
      AND EXISTS (SELECT 1 FROM public.turo_bridge_reservations r
                   WHERE r.tenant_id = t.id))            AS stranded_tenants;


-- ============================================================================
-- SMOKE TEST -- THE ONE THAT ACTUALLY GATES THE DEPLOY.
--
-- The VERIFY block above reads the catalog. This reads the anon path itself,
-- which is the thing that broke last time. Run it with the ANON / publishable
-- key, NOT the service-role key -- service_role bypasses grants entirely and
-- will happily return a row while anon is still being refused.
--
--   curl "$SUPABASE_URL/rest/v1/tenants?slug=eq.test&select=id,slug,turo_bridge_enabled" \
--        -H "apikey: $ANON_KEY"
--
-- MUST return HTTP 200 with a row. Measured before this file is applied it
-- returns HTTP 401 with {"code":"42501","message":"permission denied for table
-- tenants"} -- note it is 401, and note it blames the TABLE, never the column.
--
-- If it is anything other than 200-with-a-row, STOP: do not ship the
-- TENANT_CORE_COLUMNS change, because at that point every booking site and
-- every portal login page loses its branding the moment it deploys.
-- ============================================================================


-- ============================================================================
-- DEPLOY GATE -- THE GENERAL VERSION OF THIS BUG.
--
-- Everything above fixes ONE column. This finds the NEXT one. It takes the
-- literal TENANT_CORE_COLUMNS string out of
-- apps/portal/src/contexts/TenantContext.tsx and reports every entry that anon
-- may not read. `customer_theme_mode` would have shown up here. So would
-- `turo_bridge_enabled`, before it cost anyone an afternoon.
--
-- EXPECT ZERO ROWS. Any row is a tenant-wide outage waiting on a deploy.
--
-- When TENANT_CORE_COLUMNS changes, paste the new value in below -- it is a
-- snapshot, not a live read, and a stale snapshot silently under-reports.
-- (INSHUR columns are deliberately NOT in this list: they are shed by the
-- 42501 retry by design, and anon holds no grant on any of them today. Neither
-- is `turo_bridge_enabled` -- it lives in TENANT_OPTIONAL_COLUMNS and is shed
-- the same way. Listing it here made this gate cry wolf: it reported a
-- "tenant-wide outage" for a column whose whole design is to be sheddable.
-- Only genuine TENANT_CORE_COLUMNS entries belong in the snapshot; verified
-- 2026-09-05 that all 57 of them are granted, i.e. there is no second
-- customer_theme_mode lurking today.)
-- ============================================================================
WITH core(col) AS (
  SELECT btrim(unnest(string_to_array(
    'id, slug, company_name, status, contact_email, phone, admin_name, integration_veriff, integration_bonzah, integration_xero, integration_zoho_books, bonzah_brochure_url, bonzah_username, bonzah_mode, bonzah_sandbox_override, boldsign_mode, stripe_mode, payment_provider, subscription_stripe_mode, timezone, currency_code, distance_unit, privacy_policy_version, terms_version, policies_accepted_at, auth_logo_url, integration_twilio_sms, twilio_phone_number, integration_twilio_whatsapp, twilio_whatsapp_number, twilio_whatsapp_lockbox_template_sid, integration_whatsapp, meta_whatsapp_phone_number, maintenance_banner_enabled, maintenance_banner_message, monthly_tier_days, integration_tesla_fleet, security_deposit_enabled, global_deposit_amount, deposit_mode, deposit_charge_enabled, lead_management_enabled, automations_enabled, vehicle_owners_enabled, lead_stale_threshold_hours, lead_auto_lost_threshold_hours, communication_tone, subscription_gate_disabled, subscription_billing_anchor, setup_completed_at, customer_theme_mode, gig_driver_enabled, show_effective_daily_rate, hide_checkout_price_breakdown, allow_rental_without_id_verification, hide_vehicle_registration, push_notifications_enabled',
    ',')))
)
SELECT
  c.col AS column_name,
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns ic
                      WHERE ic.table_schema = 'public'
                        AND ic.table_name   = 'tenants'
                        AND ic.column_name  = c.col)
      THEN 'COLUMN DOES NOT EXIST -- PostgREST 400s the whole select'
    ELSE 'NO anon SELECT GRANT -- Postgres 42501s the whole row'
  END AS problem
FROM core c
WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.column_privileges cp
         WHERE cp.table_schema   = 'public'
           AND cp.table_name     = 'tenants'
           AND cp.grantee        = 'anon'
           AND cp.privilege_type = 'SELECT'
           AND cp.column_name    = c.col)
ORDER BY 1;
