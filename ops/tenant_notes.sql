-- tenant_notes — the operator's own notes and reminders, as written by them.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ BEFORE YOU APPLY THIS: READ THE LIVE BODY OF get_user_tenant_id().        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- The RLS policy below is written against `public.get_user_tenant_id()`, and
-- THIS REPO CONTAINS TWO DEFINITIONS OF THAT FUNCTION:
--
--   SAFE — supabase/migrations/20251222150000_fix_super_admin_rls.sql:28-36
--     SELECT tenant_id FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1;
--
--   NOT SAFE — supabase/migrations/20251219083413_remote_schema.sql:1958-1960
--     SELECT COALESCE(
--       (auth.jwt() -> 'user_metadata' ->> 'impersonated_tenant_id')::UUID,
--       (SELECT tenant_id FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1)
--     );
--
-- The second one reads `user_metadata` FIRST, and `user_metadata` is written by
-- the USER: any signed-in session can set it with
-- `supabase.auth.updateUser({ data: { impersonated_tenant_id: '…' } })`, and the
-- next issued JWT carries it. (`app_metadata` is the half a client cannot
-- write; this is not that half.) Under that body the helper returns whatever
-- tenant id the caller asked for, so `tenant_id = public.get_user_tenant_id()`
-- — the predicate this table's policy is built on — is satisfiable by anyone
-- holding an `authenticated` session. On this platform that includes RENTERS,
-- who sign in through the booking app and arrive with the same Postgres role,
-- and whose own auth flow is one `updateUser` call away from the claim.
--
-- The claim is not an accident: supabase/functions/master-password-login has a
-- legitimate super-admin impersonation flow that sets it
-- (`auth.admin.updateUserById`, ~line 153). So do NOT simply drop the COALESCE
-- arm as a drive-by fix — that flow, and the ledger policy that reads the same
-- claim (20260120100005_fix_ledger_rls_with_function.sql:25), depend on it.
--
-- BY FILENAME ORDER the safe definition wins — it is dated three days later.
-- That is not proof: schema on this project is applied by hand through the
-- Management API, migration files have drifted from the database before, and
-- either body is a `CREATE OR REPLACE` that could have been re-run since. So
-- check, rather than infer, and check the DATABASE:
--
--   SELECT pg_get_functiondef('public.get_user_tenant_id()'::regprocedure);
--
-- If the result mentions `impersonated_tenant_id`, this table's policy is
-- ADVISORY, not a boundary — apply the file anyway if you want the table, but
-- do not count the policy as the second lock the comments below call it, and
-- raise the function itself as its own piece of work.
--
-- KEEPING THIS PROPORTIONATE, because it is not a reason to stall this card:
--
--   * The application-layer filter holds either way. Every read and write in
--     apps/portal/src/hooks/use-tenant-notes.ts carries its own
--     `.eq('tenant_id', tenant.id)` (V2_PLAN §5), on the select, the insert, the
--     update and the delete. No portal screen can be made to show one tenant's
--     notes to another by way of this function. The exposure is a hand-made
--     PostgREST call, which never goes through that code at all.
--   * Applying this file does not create the problem and withholding it does
--     not fix it. `get_user_tenant_id()` is referenced 243 times across 74
--     migration files; if the unsafe body is live, every one of those policies
--     has the same property today, on tables far more interesting than a list
--     of an operator's notes.
--
-- ─────────────────────────────────────────────────────────────────────────────
--
-- This is the storage behind the third card of the dashboard's "On your desk"
-- band, which renders today from a hardcoded `TODOS` array
-- (apps/portal/src/components/dashboard-v2/home/mock.ts).
--
-- NOT APPLIED BY THE CODE THAT ACCOMPANIES IT. Same reasoning as
-- ops/first_run_questions.sql and ops/platform_legal_documents.sql: the standing
-- rule for this project is that schema changes go through the Supabase MCP
-- tools, and that server was unreachable in the session that wrote this. Apply
-- it deliberately, with someone watching, and delete this note when it lands.
--
-- Shipping the code first is safe. `useTenantNotes()`
-- (apps/portal/src/hooks/use-tenant-notes.ts) resolves ANY read failure —
-- missing table included — to an EMPTY list, so until this runs the canary sees
-- a calm empty card inviting them to write something, never an error. It
-- deliberately does NOT fall back to the mock rows: showing an operator five
-- invented tasks they never wrote, which they cannot tick off or delete, would
-- be worse than showing them nothing.
--
-- WHEN YOU DO APPLY IT: the whole file is one new table plus its policies, so
-- the only lock it takes on anything that already exists is the momentary one
-- Postgres needs to hang the two foreign keys off `tenants` and `app_users`.
-- Both are tiny tables and neither is rewritten. Re-running is harmless —
-- everything is IF NOT EXISTS or DROP-then-CREATE.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A NEW TABLE AND NOT `public.reminders`
--
-- `public.reminders` already exists and is a DIFFERENT KIND OF THING. It is a
-- machine-generated queue: `rule_code`, `object_type` + `object_id`, `due_on` /
-- `remind_on` dates, `severity`, `status`, `snooze_until`, `last_sent_at` — rows
-- a rule engine writes ABOUT a rental or a vehicle and later expires. It holds
-- 642 rows across 19 tenants (newest 2026-09-06, i.e. in active use), and the
-- lean product deliberately hides its screen from the canary
-- (`'reminders'` in LEAN_HIDDEN_AREAS, apps/portal/src/lib/lean-areas.ts).
--
-- What the team lead asked for is the opposite: free text a human types, with an
-- optional time beside it. Storing that in `reminders` would mean inventing a
-- `rule_code` for "a person typed this", pointing `object_id` at nothing, and
-- dropping hand-written rows into a queue that 19 other tenants' screens read
-- and that server-side rules generate and expire. So: a new table, which v1 does
-- not know exists (V2_PLAN §4).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SCOPE — NOTES AND TIMED REMINDERS. NOTHING ELSE.
--
-- The card was also discussed as a place to surface urgent system events — a
-- failed agreement, a declined card. That was PARKED, explicitly, in the same
-- meeting: "abhi nahi, baad mein faisla karenge ki yahan par kaunsi important
-- cheezein show karwani hai... abhi ke liye sirf notes add kare aur apne
-- reminder ke saath time laga ke yahan rakh sake. Bas aur kuch nahi."
--
-- So there is no `source`, no `kind`, no `object_type`/`object_id` and no link
-- column here. Deferred, not forgotten — and adding them later is additive
-- (nullable columns on a table only v2 reads), which is exactly why leaving them
-- out now costs nothing.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- V2_PLAN COMPLIANCE
--   §2  Every read and write is gated to the canary in application code, keyed
--       on the tenant SLUG (`isLeanTenant(tenant?.slug)`). Nothing here gates
--       anything — a table cannot know which tenant is on v2.
--   §4  Additive only: one new table. NO new column on `public.tenants` (the
--       269-column, 73-boolean table where `anon` holds column-level grants and
--       a grantless new column takes every tenant's booking site down).
--   §5  This table is PER-TENANT, so the isolation rule applies at full force.
--       RLS is enabled below AND every query in use-tenant-notes.ts carries its
--       own `.eq('tenant_id', tenant.id)` — on the select, the insert, the
--       update and the delete. The RLS policy is the second lock, never the
--       first: policies on this platform have been found inert before.

CREATE TABLE IF NOT EXISTS public.tenant_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NOT NULL and cascading. A note belongs to exactly one operator; there is no
  -- such thing as a platform-wide note here, and a NULL tenant_id would be a row
  -- that every tenant filter silently misses (`tenant_id = NULL` is never TRUE),
  -- i.e. an invisible orphan rather than a shared note.
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- What the operator typed. Free text, one field — the lead's "ek hi list kaafi
  -- hai inke liye". No title/body split: a note that needs two fields is a
  -- document, and this card is not a documents feature.
  body         text NOT NULL CHECK (btrim(body) <> ''),

  -- The time on a reminder. NULLABLE ON PURPOSE, and this is the whole
  -- distinction the card renders: a row with `remind_at` is a reminder and shows
  -- its time; a row without one is just a note. Not `date` — the lead asked for
  -- a TIME ("bas uska aage time aa raha hoga"), and a date column would have
  -- thrown away the only thing he named.
  --
  -- NOTHING FIRES OFF THIS COLUMN. There is no cron, no notification and no edge
  -- function reading this table; the time is displayed, not delivered. Wiring a
  -- send off it later is a separate decision with a separate blast radius.
  remind_at    timestamptz,

  is_done      boolean NOT NULL DEFAULT false,

  -- When it was ticked. Separate from `is_done` rather than derived from it, so
  -- the card can keep a just-completed row visible for a moment (an un-tick is
  -- the only undo there is) instead of having it vanish under the operator's
  -- cursor.
  completed_at timestamptz,

  -- Who wrote it — an `app_users` row, i.e. portal STAFF. Never a customer.
  -- ON DELETE SET NULL: deactivating a staff member must not delete the notes
  -- the rest of the team is still working from. Nullable for the same reason,
  -- and because a note is still readable without knowing who typed it.
  created_by   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The card's actual query: one tenant's rows, newest first. Non-unique, so it
-- changes plans and never results (V2_PLAN §4).
CREATE INDEX IF NOT EXISTS tenant_notes_tenant_created
  ON public.tenant_notes (tenant_id, created_at DESC);

-- The open list, in the order the card sorts it. Partial, because the rows that
-- matter on a dashboard are the ones still to do — a tenant with three years of
-- ticked-off notes should not be paying for them on every mount.
CREATE INDEX IF NOT EXISTS tenant_notes_open
  ON public.tenant_notes (tenant_id, remind_at)
  WHERE NOT is_done;

ALTER TABLE public.tenant_notes ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- POLICIES — WHO EACH ONE IS ACTUALLY FOR
--
-- READ THIS BEFORE COPYING THE SHAPE FROM ops/first_run_questions.sql. That file
-- grants its read policy to `authenticated` with a predicate that does not
-- mention the caller, which reads as "any signed-in portal user" and is not what
-- it means. `authenticated` is ONE Postgres role shared by everybody who holds a
-- Supabase session — and on this platform that includes RENTERS, who sign in
-- through the booking app's customer auth (`customer_users` → `customers`) and
-- arrive with exactly the same role as an operator's staff. A policy whose
-- predicate does not distinguish them hands renters the data.
--
-- These notes are an operator's private working list. A renter must never read
-- one, and the predicate — not the role — is what makes that true.

-- FOR: portal STAFF of the tenant that owns the row. Nobody else.
--
-- `get_user_tenant_id()` is the existing helper (defined in
-- supabase/migrations/20251222150000_fix_super_admin_rls.sql); it reads
-- `app_users.tenant_id` for `auth.uid()`. Everything below assumes THAT body —
-- see the warning at the top of this file for the older one still sitting in
-- the migration history, and confirm which is live before you rely on any of
-- it. That lookup is the load-bearing detail:
--
--   * An operator's staff member HAS an `app_users` row, so the helper returns
--     their tenant and they match their own tenant's notes and no others.
--   * A RENTER has NO `app_users` row. The helper returns NULL, `tenant_id =
--     NULL` evaluates to NULL, and NULL is not TRUE — so every SELECT, INSERT,
--     UPDATE and DELETE they attempt matches zero rows. They are excluded by
--     construction, not by remembering to exclude them.
--
-- FOR ALL rather than four policies: read and write have the same audience here.
-- The notes are the tenant's shared desk, not a per-user inbox — any of that
-- tenant's staff can tick off or delete any of its notes, which is how a team
-- actually works a shared list. `created_by` records who wrote it; it does not
-- restrict who may act on it.
DROP POLICY IF EXISTS tenant_notes_staff ON public.tenant_notes;
CREATE POLICY tenant_notes_staff
  ON public.tenant_notes FOR ALL TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    OR public.is_super_admin()
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    OR public.is_super_admin()
  );

-- The `is_super_admin()` arm is a JUDGEMENT CALL, recorded here so a reviewer
-- can strike it in one edit if they disagree.
--
-- Why it is there: super admins are required to have `tenant_id = NULL` in
-- `app_users`, so `get_user_tenant_id()` returns NULL for them and the first arm
-- alone would give a Drive247 admin opening a tenant's portal a permanently
-- empty card with no error anywhere — a silent failure that reads exactly like
-- a broken feature. It also costs nothing in exposure: super admins already read
-- every tenant's rentals, customers and payments through this same helper pair,
-- and the UI boundary is the application's `.eq('tenant_id', tenant.id)` (§5),
-- which pins them to the tenant whose portal they are actually looking at.
--
-- What it is NOT: a route for renters. `is_super_admin()` COALESCEs a missing
-- `app_users` row to false, so a customer session fails both arms.

-- FOR: edge functions and server-side jobs holding the service key. There are
-- none today — nothing reads this table but the portal card — and this exists so
-- that the day one is written it is not tempted to disable RLS to get in.
DROP POLICY IF EXISTS tenant_notes_service ON public.tenant_notes;
CREATE POLICY tenant_notes_service
  ON public.tenant_notes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- RLS narrows what a role may see; it does not grant the right to look. These
-- are the table privileges the policies above then narrow.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_notes TO authenticated;

-- STATED, NOT INHERITED — the same call ops/setup_checklist_items.sql makes,
-- and for the same reason. Supabase's default privileges on schema `public`
-- usually cover `service_role` on a new table, but `tenant_notes_service` above
-- is INERT without the privilege: RLS only narrows a right that exists, so a
-- role with no table privilege is refused before any policy is consulted. If
-- those defaults are ever tightened — a hardening pass, a restored database, a
-- project created from a different template — the first server-side job written
-- against this table fails with a permission error that looks nothing like the
-- policy it is really about, and the obvious "fix" is to disable RLS to get in.
-- One line here is what keeps the policy meaning what it says.
GRANT ALL ON public.tenant_notes TO service_role;

-- And explicitly nothing for `anon`. Supabase's default privileges on new public
-- tables include the anon role, and while RLS would refuse it anyway (no policy
-- names `anon`), the anon key is shipped in the JavaScript of every tenant's
-- public booking site. Two locks on an operator's private notes, not one.
REVOKE ALL ON public.tenant_notes FROM anon;

COMMENT ON TABLE public.tenant_notes IS
  'Operator-written notes and timed reminders, shown on the portal v2 dashboard "On your desk" band. Per-tenant and hand-typed — NOT public.reminders, which is the rule-generated reminder queue. No system events are recorded here; that surface was deliberately deferred.';

COMMENT ON COLUMN public.tenant_notes.remind_at IS
  'Optional time shown beside the note. NULL means it is a plain note. Nothing sends off this column — display only.';
