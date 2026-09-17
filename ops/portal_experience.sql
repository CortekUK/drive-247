-- portal_experience — which portal UI a tenant is served: the v1 chrome, or the
-- v2 rebuild that Northwind is the first sale of.
--
-- WHY THE SWITCH MOVES INTO THE ROW. Today the only switch is a hardcoded slug
-- list: apps/portal/src/lib/v2.ts holds V2_AREAS, twelve areas each set to
-- ['northwind'], and apps/portal/src/lib/lean-areas.ts holds the matching
-- LEAN_TENANTS = ['northwind']. That works for one canary and cannot work for a
-- self-serve signup, whose slug does not exist until the moment the operator
-- pays. A tenant created through drive-247.com must land on v2 without a deploy,
-- so the flag has to live where the tenant is created: on the row.
--
-- WHAT THIS FILE DOES NOT DO. It does not move any existing tenant. Every
-- current row gets 'v1' from the column DEFAULT, and the only row this file
-- names is northwind. The ~56 live tenants keep the UI they have; the portal
-- reads `isV2(area, slug) OR portal_experience = 'v2'`, and northwind is in both
-- halves on purpose, so the canary survives either one being wrong.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- ORDER OF OPERATIONS: THIS FILE FIRST, THE EDGE FUNCTION SECOND
-- ═════════════════════════════════════════════════════════════════════════════
-- supabase/functions/signup-provision INSERTs `portal_experience: 'v2'`. Deploy
-- that function before this file is applied and PostgREST rejects the INSERT
-- (PGRST204, "Could not find the 'portal_experience' column ... in the schema
-- cache"; SQLSTATE 42703 underneath) — which in that function means a card that
-- has already been charged and a workspace that was never created, on every
-- attempt, until the column exists. The function carries a fallback that retries
-- the INSERT without the column so the operator still gets their tenant, but do
-- not lean on it: a tenant provisioned through the fallback lands on v1 and has
-- to be switched by hand afterwards.
--
--   1. apply this file          (DDL; PostgREST cache reloaded on COMMIT below)
--   2. deploy signup-provision  (supabase functions deploy signup-provision)
--
-- The reverse order is also the safe order for a ROLLBACK: redeploy the previous
-- function first, drop the column second.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- RE-RUNNABLE
-- ═════════════════════════════════════════════════════════════════════════════
-- Applying this file twice is a no-op the second time, and — this is the part
-- that matters operationally — a re-run CANNOT move a tenant that someone has
-- switched by hand since the first run:
--   * ADD COLUMN IF NOT EXISTS does nothing when the column is there, and a
--     column DEFAULT is only ever applied to rows at ADD COLUMN time, never on
--     a later re-run.
--   * the CHECK is added only when absent, so a re-run does not error 42710.
--   * the one UPDATE is keyed to slug = 'northwind'.
-- What a re-run does NOT do is CHANGE an existing CHECK (same rule as
-- ops/portal_announcements.sql). If the allowed set ever grows past ('v1','v2'),
-- widen it with an explicit ALTER; editing the CHECK below will not take effect.
--
-- If the column already exists from a hand-apply, sections 1b/1c converge it on
-- the intended shape (DEFAULT 'v1', NOT NULL, no NULLs) rather than assuming it.
-- The one case that deliberately FAILS LOUDLY is a pre-existing column holding a
-- value outside ('v1','v2') — the ADD CONSTRAINT then raises 23514 and the whole
-- transaction rolls back. Run the third pre-flight query below first and you will
-- see it coming.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- BEFORE YOU APPLY (read-only)
-- ═════════════════════════════════════════════════════════════════════════════
--   -- does the column exist yet, and with what shape?
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'tenants'
--      AND column_name = 'portal_experience';                  -- expect: 0 rows
--
--   -- is the constraint name free?
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.tenants'::regclass
--      AND conname = 'tenants_portal_experience_check';        -- expect: 0 rows
--
--   -- only meaningful if the column DOES already exist: any value the CHECK
--   -- would reject? A non-empty result means STOP and reconcile by hand.
--   SELECT portal_experience, count(*) FROM public.tenants
--    GROUP BY 1 ORDER BY 2 DESC;
--
--   -- the canary exists and is spelled the way the slug lists spell it
--   SELECT id, slug, status FROM public.tenants WHERE slug = 'northwind';
--
--   -- the grant model this file depends on: anon must have NO table-level
--   -- SELECT (it holds ~236 column grants instead), authenticated must have one
--   SELECT has_table_privilege('anon','public.tenants','SELECT')          AS anon_table_select,      -- expect false
--          has_table_privilege('authenticated','public.tenants','SELECT') AS auth_table_select;      -- expect true
--
-- ═════════════════════════════════════════════════════════════════════════════
-- WHY THE COLUMN GRANT IS LOAD-BEARING (section 4)
-- ═════════════════════════════════════════════════════════════════════════════
-- supabase/migrations/20260723090000_lock_down_tenants_rls.sql revoked anon's
-- TABLE-level SELECT on public.tenants and re-granted an explicit allow-list of
-- non-secret COLUMNS (the Twilio-token incident). A column added after that
-- migration is therefore invisible to the anon key by default, and Postgres
-- refuses the WHOLE row for any SELECT that so much as names it — which is how a
-- single missing grant has previously blanked the branding on every booking site
-- at once (see the same warning in 20260820150000_add_booking_v2_flag.sql and
-- 20260825172706_square_provider_columns.sql).
--
-- Here it bites in a second place. apps/portal/src/app/layout.tsx does its one
-- server-side tenant read with NEXT_PUBLIC_SUPABASE_ANON_KEY — i.e. as anon — in
-- the same SELECT that fetches app_name, meta_title and the brand colours. An
-- ungranted portal_experience does not merely fail closed to v1: it 403s that
-- whole read, so every v2 tenant loses its <title>, its favicon and its brand
-- paint as well. Hence anon.
--
-- `authenticated` already holds a table-level SELECT and needs nothing today;
-- the grant is written out anyway because the lock-down migration's own note
-- calls revoking that table grant "Phase 2", and when Phase 2 lands this column
-- must not be the one that gets left behind.

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1a. The column.
-- ═════════════════════════════════════════════════════════════════════════════
-- text, not an enum: every other mode flag on this table (boldsign_mode,
-- stripe_mode, square_mode, payment_provider, bonzah_mode) is text + CHECK, and
-- an enum cannot be widened inside a transaction on older servers.
--
-- DEFAULT 'v1' is the whole safety property of this change. It is what keeps the
-- existing tenants — and any tenant a super admin creates from the admin app,
-- which does not set this column — on the UI they already have.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS portal_experience text NOT NULL DEFAULT 'v1';

-- ═════════════════════════════════════════════════════════════════════════════
-- 1b/1c. Converge a pre-existing column on the same shape (no-ops on a fresh
-- one). Deliberate, not belt-and-braces: schema on this project is applied by
-- hand through the Management API and has drifted from the files before.
-- ═════════════════════════════════════════════════════════════════════════════
UPDATE public.tenants
   SET portal_experience = 'v1'
 WHERE portal_experience IS NULL;

ALTER TABLE public.tenants ALTER COLUMN portal_experience SET DEFAULT 'v1';
ALTER TABLE public.tenants ALTER COLUMN portal_experience SET NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. The domain. Two values, and the portal treats everything else as v1.
-- ═════════════════════════════════════════════════════════════════════════════
-- The CHECK is not what protects the portal — apps/portal/src/lib/v2.ts fails
-- closed on any unknown value, per decision 4 — it is what stops a typo
-- ('V2', 'v2 ', 'true') from being stored at all and then puzzling someone for
-- an afternoon.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tenants'::regclass
       AND conname  = 'tenants_portal_experience_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_portal_experience_check
      CHECK (portal_experience IN ('v1', 'v2'));
  END IF;
END
$$;

COMMENT ON COLUMN public.tenants.portal_experience IS
 'Which portal UI this tenant is served: ''v1'' (default, the original chrome) or ''v2'' (the rebuild Northwind is the first sale of). Read server-side by apps/portal/src/app/layout.tsx as the anon role and OR-ed with the hardcoded slug lists in lib/v2.ts / lib/lean-areas.ts; any unknown or missing value resolves to v1. Set to ''v2'' at INSERT by the self-serve signup (supabase/functions/signup-provision); tenants created by a super admin in the admin app stay ''v1'' unless someone changes them. Nothing to do with tenants.booking_v2_enabled, which switches the BOOKING site''s landing page.';

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. The canary. Northwind is already on v2 by slug list; this makes the row
--    agree, so the slug list can later be emptied without moving it.
-- ═════════════════════════════════════════════════════════════════════════════
-- IS DISTINCT FROM, not <>: on a hand-made nullable column, `<> 'v2'` is NULL
-- for a NULL row, the UPDATE quietly matches nothing, and northwind is left
-- behind. (Sections 1b/1c make that impossible here — belt and braces, because
-- the failure is silent and the row is the one customer we have on v2.)
UPDATE public.tenants
   SET portal_experience = 'v2'
 WHERE slug = 'northwind'
   AND portal_experience IS DISTINCT FROM 'v2';

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Grants. MANDATORY — see the long note in the header before editing.
-- ═════════════════════════════════════════════════════════════════════════════
GRANT SELECT (portal_experience) ON public.tenants TO anon;
GRANT SELECT (portal_experience) ON public.tenants TO authenticated;

-- The portal reads this column through PostgREST on the very next request, so
-- the schema cache must already know about it. Supabase's DDL watcher normally
-- reloads it; this makes it explicit (delivered on COMMIT).
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- AFTER YOU APPLY (read-only)
-- ═════════════════════════════════════════════════════════════════════════════
--   -- shape: text, NOT NULL, DEFAULT 'v1'
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'tenants'
--      AND column_name = 'portal_experience';
--
--   -- the CHECK, exactly once
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.tenants'::regclass
--      AND conname = 'tenants_portal_experience_check';
--
--   -- who is on v2: expect exactly one row, northwind
--   SELECT slug, portal_experience FROM public.tenants
--    WHERE portal_experience = 'v2' ORDER BY slug;
--
--   -- and the rest are all v1
--   SELECT portal_experience, count(*) FROM public.tenants GROUP BY 1 ORDER BY 1;
--
--   -- the grants landed (all four true)
--   SELECT has_column_privilege('anon','public.tenants','portal_experience','SELECT')          AS anon_col,
--          has_column_privilege('authenticated','public.tenants','portal_experience','SELECT') AS auth_col,
--          has_column_privilege('anon','public.tenants','primary_color','SELECT')              AS anon_still_reads_brand,
--          NOT has_column_privilege('anon','public.tenants','twilio_auth_token','SELECT')      AS anon_still_blind_to_secrets;
--
--   -- PostgREST really can see it (run as anon, e.g. from a browser or curl
--   -- with the anon key):  GET /rest/v1/tenants?select=slug,portal_experience
