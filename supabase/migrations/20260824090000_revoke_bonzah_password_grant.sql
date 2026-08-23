-- Revoke `authenticated`'s read access to tenants.bonzah_password.
--
-- ██ DO NOT APPLY THIS YET. Read the prerequisite section first. ██
--
-- WHAT IT FIXES
-- `authenticated` holds a TABLE-LEVEL SELECT on `tenants`, so every logged-in
-- user of every tenant can read `bonzah_password` — a stored third-party
-- credential in plaintext — along with `bonzah_partner_id`. Verified live:
--
--   select grantee, privilege_type from information_schema.table_privileges
--    where table_name='tenants' and grantee='authenticated';
--   -> SELECT (table-level), plus INSERT/UPDATE/DELETE
--
-- A table-level grant dominates column-level ones, so
-- `REVOKE SELECT (bonzah_password)` on its own does nothing. The only way to
-- exclude one column is to drop the table grant and re-grant every OTHER column
-- explicitly, which is what the DO block below does — generating the list from
-- information_schema rather than hand-listing ~200 columns, because a
-- hand-written list that misses one column 403s that whole query forever.
--
-- ██ PREREQUISITE — THE PART THE ORIGINAL HANDOVER UNDER-COUNTED ██
--
-- PostgREST fails the WHOLE query with 42501 if the caller lacks a grant on any
-- ONE selected column, and `SELECT *` in Postgres requires the table grant, not
-- the union of column grants. So the moment this runs, every `select('*')` on
-- `tenants` executed as `authenticated` starts failing.
--
-- There are THREE such call sites live today:
--
--   apps/portal/src/hooks/use-rental-settings.ts:200
--   apps/admin/app/admin/(protected)/rentals/page.tsx:605
--   apps/admin/app/admin/(protected)/rentals/[id]/page.tsx:466
--
-- Each must be changed to an explicit column list and DEPLOYED before this runs.
-- The handover recorded the blocker as the Bonzah settings page alone; that one
-- is already fixed (bonzah-settings.tsx selects an explicit list and both its
-- writes use return=minimal, so neither needs SELECT on the column). These three
-- are the remaining blockers, and they are not Bonzah screens — they would take
-- out the portal's rental settings and the entire admin rentals list.
--
-- A fourth call site, apps/booking/src/lib/tenantQueries.ts:67, also does
-- `select('*')` but is DEAD CODE (no importers) and runs as `anon`, which
-- already holds only column grants.
--
-- ORDER OF OPERATIONS
--   1. Replace the three `select('*')` calls with explicit column lists
--   2. Deploy portal and admin
--   3. Verify the rental settings page and admin rentals list still load
--   4. Then apply this
--
-- Doing it in the other order 403s three live screens for every operator.

BEGIN;

DO $$
DECLARE
  v_cols text;
  v_blocked int;
BEGIN
  -- Refuse to run if the column is already unreachable, so re-running is safe.
  SELECT count(*) INTO v_blocked
  FROM information_schema.table_privileges
  WHERE table_name = 'tenants'
    AND table_schema = 'public'
    AND grantee = 'authenticated'
    AND privilege_type = 'SELECT';

  IF v_blocked = 0 THEN
    RAISE NOTICE 'authenticated already has no table-level SELECT on tenants; nothing to do.';
    RETURN;
  END IF;

  -- Every column EXCEPT the stored credential. Generated, never hand-listed:
  -- omitting a column here is indistinguishable from a permissions bug at
  -- runtime, and would surface as a blank settings page rather than an error.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'tenants'
    AND column_name <> 'bonzah_password';

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'Could not enumerate tenants columns; aborting rather than revoking blindly.';
  END IF;

  EXECUTE 'REVOKE SELECT ON public.tenants FROM authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.tenants TO authenticated', v_cols);

  RAISE NOTICE 'authenticated can no longer read tenants.bonzah_password.';
END $$;

COMMIT;

-- ── verification ────────────────────────────────────────────────────────────
-- Expect one row for bonzah_password: service_role only (plus postgres).
--
--   select grantee from information_schema.column_privileges
--    where table_name='tenants' and column_name='bonzah_password'
--      and privilege_type='SELECT';
--
-- And confirm the three screens above still load. If one 403s with 42501, a
-- `select('*')` was missed — re-grant with
-- `GRANT SELECT ON public.tenants TO authenticated;` and fix the call site.
