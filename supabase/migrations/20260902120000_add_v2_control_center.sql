-- ---------------------------------------------------------------------------
-- v2 Control Center — batch-based release management
--
-- WHAT THIS IS FOR
--
-- The v2 UI is being rebuilt with a strangler pattern: each new screen ships as
-- a separate route beside the one it will eventually replace, and tenants are
-- moved across one at a time. The unit of work is a BATCH — one coherent change
-- that owns one area (the new dashboard, the new vehicle screens, ...), built on
-- its own branch, merged, verified on `northwind`, then rolled out tenant by
-- tenant.
--
-- Three tables, one concern each:
--
--   batches         — the change itself: what it is, who owns it, where it is
--   tenant_batches  — the rollout: which tenant currently sees which batch
--   batch_files     — attachments (specs, screenshots, before/afters)
--
-- The rollout is deliberately NOT a column on `batches`. A batch is live for
-- some tenants and not others for most of its life, so "is it on" only has an
-- answer per tenant. Keeping it in its own table is also what makes a rollback
-- cheap and auditable: flip one row, and the row remembers who flipped it.
--
-- THE KILL-SWITCH
--
-- `batches.killswitch` is the panic lever, one level above the per-tenant flags.
-- Effective state is:
--
--     NOT batches.killswitch AND tenant_batches.enabled
--
-- It is a separate column rather than "set enabled = false everywhere" on
-- purpose: pulling the switch must be ONE write, reversible without having to
-- reconstruct which tenants were on before the incident. The per-tenant rows are
-- left exactly as they were, so releasing the switch restores the previous
-- rollout precisely.
--
-- NOTHING EXISTING IS TOUCHED. This migration only adds; it alters no existing
-- table, policy, function or trigger.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Vocabularies
-- ---------------------------------------------------------------------------

-- Where a batch is in its life. Fixed set, so an enum: a typo'd status must be
-- a write error, not a row that silently never matches a filter.
--
--   not_started     — planned, no branch yet
--   in_progress     — being built
--   testing         — merged, being verified on `northwind`
--   partial_rollout — live for some tenants, not all
--   pending         — finished, waiting on a decision (review, sign-off)
--   rejected        — abandoned; releases its `area` for another batch
--   completed       — rolled out everywhere; releases its `area`
DO $$ BEGIN
  CREATE TYPE public.v2_batch_status AS ENUM (
    'not_started',
    'in_progress',
    'testing',
    'partial_rollout',
    'pending',
    'rejected',
    'completed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tags stay text[] rather than an enum array. The vocabulary is fixed TODAY and
-- the CHECK below enforces it, but this list is the kind that grows during a
-- rewrite, and growing a text[] whitelist is a one-line migration while
-- ALTER TYPE ... ADD VALUE cannot run in the same transaction as the code that
-- uses it. Containment (`<@`) is immutable, so it is legal in a CHECK.


-- ---------------------------------------------------------------------------
-- 2. batches — the unit of work
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The human handle: 'b1', 'b2'. Unique because it is what everyone says out
  -- loud and writes in branch names; two batches called b3 would make every
  -- conversation about the rollout ambiguous.
  key         text NOT NULL UNIQUE
                CHECK (key ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description text,

  status      public.v2_batch_status NOT NULL DEFAULT 'not_started',

  tags        text[] NOT NULL DEFAULT '{}'
                CHECK (tags <@ ARRAY[
                  'ui',
                  'architecture',
                  'api',
                  'refactoring',
                  'cutting',
                  'testing',
                  'documentation',
                  'feature_addition'
                ]::text[]),

  branch      text,
  owner       text,

  -- The screen or area this batch owns. Two batches rewriting the same screen
  -- at once is the failure mode this whole scheme exists to avoid, so ownership
  -- is enforced by an index (below), not by convention.
  area        text,

  -- [{ id, text, done, done_at, done_by }]. Kept as jsonb rather than a fourth
  -- table: a checklist is edited as a whole, is never queried across batches,
  -- and has no life of its own once the batch is gone.
  checklist   jsonb NOT NULL DEFAULT '[]'::jsonb
                CHECK (jsonb_typeof(checklist) = 'array'),

  -- The panic lever. See the header.
  killswitch  boolean NOT NULL DEFAULT false,

  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.batches IS
  'v2 Control Center: one coherent UI-rewrite change, rolled out per tenant via tenant_batches.';
COMMENT ON COLUMN public.batches.killswitch IS
  'Global off switch for this batch. Effective state per tenant is (NOT killswitch AND tenant_batches.enabled); the per-tenant rows are left untouched so releasing the switch restores the exact previous rollout.';
COMMENT ON COLUMN public.batches.area IS
  'The screen/area this batch owns. Unique among batches that are still live (see batches_area_live_uniq) so two batches cannot claim the same screen.';
COMMENT ON COLUMN public.batches.checklist IS
  'JSON array of { id, text, done, done_at, done_by }.';

-- One live owner per area. `completed` and `rejected` batches release their
-- claim, so the next batch touching that screen is free to take it.
-- lower() so 'Dashboard' and 'dashboard' are the same claim.
CREATE UNIQUE INDEX IF NOT EXISTS batches_area_live_uniq
  ON public.batches (lower(area))
  WHERE area IS NOT NULL
    AND btrim(area) <> ''
    AND status NOT IN ('completed', 'rejected');

CREATE INDEX IF NOT EXISTS batches_status_idx ON public.batches (status);

DROP TRIGGER IF EXISTS set_batches_updated_at ON public.batches;
CREATE TRIGGER set_batches_updated_at
  BEFORE UPDATE ON public.batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 3. tenant_batches — the rollout
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  enabled         boolean NOT NULL DEFAULT false,

  -- Who/when, both directions. A rolled-back row is kept rather than deleted:
  -- "we tried b4 on RevTek on the 3rd and pulled it on the 4th" is exactly the
  -- question asked after an incident, and a DELETE cannot answer it.
  enabled_at      timestamptz,
  enabled_by      text,
  rolled_back_at  timestamptz,
  rolled_back_by  text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenant_batches_batch_tenant_key UNIQUE (batch_id, tenant_id)
);

COMMENT ON TABLE public.tenant_batches IS
  'v2 Control Center: whether one tenant currently sees one batch. Rolled-back rows are kept (enabled=false with rolled_back_at set), never deleted.';

CREATE INDEX IF NOT EXISTS tenant_batches_batch_idx  ON public.tenant_batches (batch_id);
CREATE INDEX IF NOT EXISTS tenant_batches_tenant_idx ON public.tenant_batches (tenant_id);

DROP TRIGGER IF EXISTS set_tenant_batches_updated_at ON public.tenant_batches;
CREATE TRIGGER set_tenant_batches_updated_at
  BEFORE UPDATE ON public.tenant_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 4. batch_files — attachments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.batch_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,

  file_name   text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 300),

  -- The OBJECT PATH inside the `batch-files` bucket, e.g. '<batch_id>/<uuid>.png'
  -- — not an absolute URL. The bucket is private, so a durable URL cannot exist:
  -- the admin app mints a short-lived signed URL from this path on click.
  file_url    text NOT NULL,

  file_size   bigint CHECK (file_size IS NULL OR file_size >= 0),
  uploaded_by text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.batch_files IS
  'v2 Control Center: files attached to a batch (specs, screenshots, before/afters).';
COMMENT ON COLUMN public.batch_files.file_url IS
  'Object path inside the private `batch-files` storage bucket, not an absolute URL. Signed on demand.';

CREATE INDEX IF NOT EXISTS batch_files_batch_idx ON public.batch_files (batch_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- 5. RLS
--
-- Super admins own all three tables. The one exception is the read a TENANT
-- needs: the portal has to know which batches it is on to decide which UI to
-- render, so a tenant may SELECT its OWN tenant_batches rows — and nothing else.
--
-- Note what that read alone does NOT give them: `batches` stays closed, so the
-- rows are opaque uuids. The function in section 7 is the supported way for the
-- portal to turn those into batch keys, and it applies the killswitch on the
-- way — so a tenant can never see a state the switch has revoked.
-- ---------------------------------------------------------------------------
ALTER TABLE public.batches        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_files    ENABLE ROW LEVEL SECURITY;

-- ── batches ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS batches_super_admin_all ON public.batches;
CREATE POLICY batches_super_admin_all ON public.batches
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS batches_service_role_all ON public.batches;
CREATE POLICY batches_service_role_all ON public.batches
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── tenant_batches ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS tenant_batches_super_admin_all ON public.tenant_batches;
CREATE POLICY tenant_batches_super_admin_all ON public.tenant_batches
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Read-only, own tenant only. No WITH CHECK because there is no write verb
-- here: a tenant must never be able to switch itself onto a batch.
DROP POLICY IF EXISTS tenant_batches_select_own_tenant ON public.tenant_batches;
CREATE POLICY tenant_batches_select_own_tenant ON public.tenant_batches
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS tenant_batches_service_role_all ON public.tenant_batches;
CREATE POLICY tenant_batches_service_role_all ON public.tenant_batches
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── batch_files ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS batch_files_super_admin_all ON public.batch_files;
CREATE POLICY batch_files_super_admin_all ON public.batch_files
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS batch_files_service_role_all ON public.batch_files;
CREATE POLICY batch_files_service_role_all ON public.batch_files
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Defence in depth. RLS already blocks anon (no anon policy exists), but new
-- tables in `public` carry a default grant to anon, and that grant is all that
-- stands between the public anon key and a future careless policy. Remove it so
-- these tables are unreachable by the anon key by construction, not by policy.
REVOKE ALL ON public.batches        FROM anon;
REVOKE ALL ON public.tenant_batches FROM anon;
REVOKE ALL ON public.batch_files    FROM anon;

-- Deliberately NOT revoked from `authenticated`. The super admin driving the
-- Control Center connects as `authenticated` like everyone else — the super
-- admin flag lives in app_users, not in the Postgres role — so revoking writes
-- from that role would lock the operator out of their own tool. RLS is the
-- boundary here: a tenant has a SELECT policy and no other, so its writes are
-- refused for want of a policy, which is exactly as binding as a revoke.


-- ---------------------------------------------------------------------------
-- 6. Storage — the `batch-files` bucket
--
-- Private. These are internal specs and screenshots of unreleased screens; an
-- unguessable path is not an access control. The admin app signs a URL per
-- click instead.
--
-- Path convention: {batch_id}/{uuid}.{ext}
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('batch-files', 'batch-files', false, 52428800)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800;

DROP POLICY IF EXISTS "Super admins upload batch files" ON storage.objects;
CREATE POLICY "Super admins upload batch files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'batch-files' AND public.is_super_admin());

DROP POLICY IF EXISTS "Super admins read batch files" ON storage.objects;
CREATE POLICY "Super admins read batch files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'batch-files' AND public.is_super_admin());

DROP POLICY IF EXISTS "Super admins update batch files" ON storage.objects;
CREATE POLICY "Super admins update batch files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'batch-files' AND public.is_super_admin())
  WITH CHECK (bucket_id = 'batch-files' AND public.is_super_admin());

DROP POLICY IF EXISTS "Super admins delete batch files" ON storage.objects;
CREATE POLICY "Super admins delete batch files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'batch-files' AND public.is_super_admin());


-- ---------------------------------------------------------------------------
-- 7. The effective-state read, for the portal
--
-- One place where `NOT killswitch AND enabled` is decided. If each client
-- re-implemented it, the killswitch would only be as good as the sloppiest of
-- them — and a switch that some screens ignore is worse than none, because it
-- reads as pulled when it is not.
--
-- SECURITY DEFINER so it can join `batches`, which the caller cannot read. It
-- returns keys and nothing else, and only ever for the caller's own tenant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_enabled_batch_keys()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(array_agg(b.key ORDER BY b.key), '{}'::text[])
    FROM public.tenant_batches tb
    JOIN public.batches b ON b.id = tb.batch_id
   WHERE tb.tenant_id = public.get_user_tenant_id()
     AND tb.enabled
     AND NOT b.killswitch;
$$;

COMMENT ON FUNCTION public.get_enabled_batch_keys() IS
  'v2 Control Center: the batch keys currently in effect for the calling user''s tenant, i.e. (NOT batches.killswitch AND tenant_batches.enabled). The single authority on effective state.';

GRANT EXECUTE ON FUNCTION public.get_enabled_batch_keys() TO authenticated;
