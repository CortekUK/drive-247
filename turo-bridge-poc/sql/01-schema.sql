-- ============================================================================
-- Drive247 Turo Bridge (PoC) — schema
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → paste → Run. (Runs as service_role.)
--   Or: mcp__supabase__apply_migration. Per the project's standing convention,
--   PREFER applying this through the Supabase MCP tools over dropping a file
--   into supabase/migrations/ that the CLI would later replay.
--
--   It is idempotent and safe to run more than once.
--
-- ⚠ THIS FILE IS A FORWARD MIGRATION, NOT A FRESH CREATE.
--   An earlier draft (supabase/migrations/20260831120000_add_turo_bridge_poc.sql)
--   HAS ALREADY BEEN APPLIED to production (hviqoaokxvlancmftwuo). Verified
--   against the live catalog: turo_bridge_tokens exists carrying a PLAINTEXT
--   `token text` column and one row; turo_bridge_reservations exists with one
--   row. So a plain CREATE TABLE IF NOT EXISTS would silently no-op and leave
--   the plaintext credential in place, while turo-bridge-ingest — which compares
--   SHA-256 digests — would query a token_hash column that does not exist and
--   fail every sync. Section 2 below therefore MIGRATES the existing table:
--   add the digest columns, backfill them from the plaintext value so the
--   already-issued demo token keeps working, then DROP the plaintext column.
--
-- THE SECURITY MODEL IN ONE PARAGRAPH
--   The operator is signed into turo.com, not into Drive247, so there is no
--   Supabase JWT in that browser context. `turo-bridge-ingest` runs with
--   verify_jwt = false and the pairing token in the request body is the whole
--   credential. The client never names a tenant; the edge function resolves
--   tenant_id from the token, so a forged tenant is not expressible in the wire
--   format. Plaintext tokens are never stored — only sha256(token) as hex.
-- ============================================================================

BEGIN;

-- ===========================================================================
-- 1. RESERVATIONS — the landing zone.
--
-- Deliberately NOT `rentals`. A half-formed PoC row in `rentals` would enter
-- the pricing, agreement, Stripe and cron machinery. Nothing downstream reads
-- this table; promotion into a real rental is a separate, out-of-scope step.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.turo_bridge_reservations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Turo's own id for the trip. TEXT, not bigint: Turo has returned both
  -- numeric ids and uuid-ish strings across its endpoints and we do not control
  -- which the undocumented feed hands back. A bigint column would reject half
  -- the real payloads while the fixture still passed — hiding it until demo day.
  reservation_id text NOT NULL,

  -- 'fixture' rows come from the extension's bundled sample (there is no Turo
  -- account to test against). Keeping the two permanently distinguishable IN
  -- THE DATABASE is the entire point of this column: a demo that cannot tell
  -- you which of the two paths it just exercised is worth very little, and demo
  -- data mistaken for a real booking is the worst outcome this feature has.
  source         text NOT NULL DEFAULT 'turo'
                 CHECK (source IN ('turo', 'fixture')),

  guest_name     text,
  vehicle_label  text,
  starts_at      timestamptz,
  ends_at        timestamptz,

  -- OUR sync state, not Turo's trip state. Turo's own status stays inside
  -- `raw`. Conflating the two is how a demo ends up claiming a cancelled trip
  -- is active.
  status         text NOT NULL DEFAULT 'synced'
                 CHECK (status IN ('synced', 'imported', 'failed')),

  total_amount   numeric(12,2),
  currency       text,

  -- The untouched Turo trip object. The feed is undocumented and our column
  -- mapping is an educated guess, so the whole object always travels along:
  -- guessing a column wrong then costs one NULL, not the reservation.
  raw            jsonb NOT NULL DEFAULT '{}'::jsonb,

  synced_at      timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- Idempotency, and it must be a NAMED table constraint so PostgREST can
  -- target it with onConflict: 'tenant_id,reservation_id'. This is what makes
  -- "just click Sync again" the correct recovery when the MV3 service worker is
  -- killed mid-flight.
  CONSTRAINT turo_bridge_reservations_tenant_reservation_key
    UNIQUE (tenant_id, reservation_id)
);

CREATE INDEX IF NOT EXISTS turo_bridge_reservations_tenant_synced_idx
  ON public.turo_bridge_reservations (tenant_id, synced_at DESC);

DROP TRIGGER IF EXISTS set_turo_bridge_reservations_updated_at
  ON public.turo_bridge_reservations;
CREATE TRIGGER set_turo_bridge_reservations_updated_at
  BEFORE UPDATE ON public.turo_bridge_reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.turo_bridge_reservations ENABLE ROW LEVEL SECURITY;

-- House pattern, copied from push_subscriptions
-- (20260820120000_add_web_push.sql:131-147): tenant-scoped SELECT for staff,
-- explicit service_role FOR ALL. Super admins carry tenant_id = NULL by design,
-- which is why the flag is ORed rather than compared.
DROP POLICY IF EXISTS turo_bridge_reservations_select_own_tenant
  ON public.turo_bridge_reservations;
CREATE POLICY turo_bridge_reservations_select_own_tenant
  ON public.turo_bridge_reservations
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- service_role bypasses RLS anyway; the policy documents the intent in the
-- schema itself, which is the repo's convention.
DROP POLICY IF EXISTS turo_bridge_reservations_service_role_all
  ON public.turo_bridge_reservations;
CREATE POLICY turo_bridge_reservations_service_role_all
  ON public.turo_bridge_reservations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ⚠ FIXES A LIVE DEFECT. The applied draft revoked `anon` but left
-- `authenticated` holding INSERT/UPDATE/DELETE (verified in
-- information_schema.role_table_grants). RLS's SELECT-only policy does not
-- constrain writes for which no policy exists — but the table grant is what
-- PostgREST checks first, and leaving it means any signed-in portal user could
-- attempt to forge or delete Turo rows. All writes come from the edge function
-- as service_role; the portal view is strictly read-only.
REVOKE ALL ON public.turo_bridge_reservations FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
  ON public.turo_bridge_reservations FROM authenticated;
GRANT SELECT ON public.turo_bridge_reservations TO authenticated;

COMMENT ON TABLE public.turo_bridge_reservations IS
  'Turo Bridge PoC landing zone. Written only by turo-bridge-ingest (service_role). Not a rental.';

-- ===========================================================================
-- 2. TOKENS — the credential table.
--
-- One pasteable string per operator machine. The PLAINTEXT IS NEVER STORED.
-- ===========================================================================

-- Fresh-install shape. On production this is a no-op (the table already
-- exists), which is exactly why the migration block below is not optional.
CREATE TABLE IF NOT EXISTS public.turo_bridge_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- sha256(token) as lowercase hex. Shape copied from strategy_call_sessions
  -- (20260815120000_strategy_call_booking_funnel.sql:26,34-35).
  token_hash   text,

  -- First 14 chars ('d247_turo_' + 4). sha256 is one-way, so once the plaintext
  -- is gone this prefix is the ONLY way to ever say WHICH token a row is — in
  -- the portal, or to an operator on the phone.
  token_prefix text,

  label        text,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ---- 2a. Bring the already-applied plaintext table up to the hashed shape --
-- Every step is guarded, so this is a no-op on a table that is already correct.
ALTER TABLE public.turo_bridge_tokens
  ADD COLUMN IF NOT EXISTS token_hash   text,
  ADD COLUMN IF NOT EXISTS token_prefix text,
  ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now();

-- Backfill the digest from any surviving plaintext, so a token that has ALREADY
-- been pasted into an extension keeps working across this migration. Runs only
-- while the legacy column still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'turo_bridge_tokens'
      AND column_name  = 'token'
  ) THEN
    EXECUTE $sql$
      UPDATE public.turo_bridge_tokens
         SET token_hash   = COALESCE(token_hash,
                              encode(extensions.digest(token, 'sha256'), 'hex')),
             token_prefix = COALESCE(token_prefix, left(token, 14))
       WHERE token IS NOT NULL
         AND (token_hash IS NULL OR token_prefix IS NULL)
    $sql$;

    -- The plaintext credential is now redundant. Dropping it is the point of
    -- the whole exercise: after this, a dump of this table yields no usable
    -- token. CASCADE clears the draft's UNIQUE(token) index along with it.
    EXECUTE 'ALTER TABLE public.turo_bridge_tokens DROP COLUMN token CASCADE';
    RAISE NOTICE 'turo_bridge_tokens: plaintext token column backfilled to sha256 and dropped.';
  END IF;
END $$;

-- Any row that still has no digest is unusable (it can never match a request)
-- and is a leftover from a partial run. Remove it rather than leave a NULL that
-- would block the NOT NULL below.
DELETE FROM public.turo_bridge_tokens WHERE token_hash IS NULL;

ALTER TABLE public.turo_bridge_tokens
  ALTER COLUMN token_hash   SET NOT NULL,
  ALTER COLUMN token_prefix SET NOT NULL;

-- ---- 2b. Constraints -------------------------------------------------------
-- The regex CHECK is load-bearing, not decoration: it makes storing a plaintext
-- token in this column PHYSICALLY IMPOSSIBLE, so a careless future mint
-- statement fails loudly instead of silently downgrading the scheme.
DO $$
BEGIN
  ALTER TABLE public.turo_bridge_tokens
    ADD CONSTRAINT turo_bridge_tokens_hash_valid
    CHECK (token_hash ~ '^[0-9a-f]{64}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.turo_bridge_tokens
    ADD CONSTRAINT turo_bridge_tokens_prefix_valid
    CHECK (char_length(token_prefix) BETWEEN 4 AND 32);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.turo_bridge_tokens
    ADD CONSTRAINT turo_bridge_tokens_hash_key UNIQUE (token_hash);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS turo_bridge_tokens_tenant_idx
  ON public.turo_bridge_tokens (tenant_id) WHERE revoked_at IS NULL;

DROP TRIGGER IF EXISTS set_turo_bridge_tokens_updated_at
  ON public.turo_bridge_tokens;
CREATE TRIGGER set_turo_bridge_tokens_updated_at
  BEFORE UPDATE ON public.turo_bridge_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- 2c. RLS + grants ------------------------------------------------------
ALTER TABLE public.turo_bridge_tokens ENABLE ROW LEVEL SECURITY;

-- Staff may see WHICH tokens exist for their own tenant (prefix, label, last
-- used) so the portal can list and revoke them. They can never see the digest —
-- that is enforced by the column grant below, not by this policy.
DROP POLICY IF EXISTS turo_bridge_tokens_select_own_tenant
  ON public.turo_bridge_tokens;
CREATE POLICY turo_bridge_tokens_select_own_tenant
  ON public.turo_bridge_tokens
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS turo_bridge_tokens_service_role_all
  ON public.turo_bridge_tokens;
CREATE POLICY turo_bridge_tokens_service_role_all
  ON public.turo_bridge_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Credential table: defence in depth on top of RLS, per
-- 20260825175054_square_revoke_anon_on_credential_tables.sql:17-23.
--
-- ORDER MATTERS. PostgreSQL documents that revoking a COLUMN privilege from a
-- holder of a TABLE-level grant is a silent no-op — this repo has already been
-- bitten by it and wrote it down in that file's header. So the table-level
-- REVOKE must come FIRST; only then does the column GRANT define the whole of
-- what `authenticated` can see. token_hash is omitted from that list on
-- purpose: a digest is not a secret worth handing out, but there is no reason
-- for a browser to hold it either.
REVOKE ALL ON public.turo_bridge_tokens FROM anon, authenticated;
GRANT SELECT (id, tenant_id, token_prefix, label, last_used_at, revoked_at, created_at)
  ON public.turo_bridge_tokens TO authenticated;

COMMENT ON TABLE public.turo_bridge_tokens IS
  'Turo Bridge pairing tokens. sha256 digests only — plaintext is never stored and cannot be recovered.';

-- ===========================================================================
-- 3. REALTIME
--
-- The portal page subscribes so the synced row appears without a refresh.
-- This is safe here for a reason that does NOT generalise: the table has RLS ON
-- with a tenant-scoped SELECT policy, so postgres_changes enforces that policy
-- per subscriber. CLAUDE.md's objection to publishing a table (see "Live sync")
-- is scoped to tables with RLS OFF, where a tenant_id channel filter is "a
-- convenience filter, not an access boundary". These rows carry guest names, so
-- the RLS policy above is a PRECONDITION of this publication, not a nicety.
--
-- turo_bridge_tokens is deliberately NOT published. Credential tables never are.
-- ===========================================================================
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.turo_bridge_reservations;
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- already published
  WHEN undefined_object THEN NULL;  -- no supabase_realtime publication here
END $$;

COMMIT;

-- ===========================================================================
-- VERIFY (run after; expect plaintext_column_remaining = 0)
-- ===========================================================================
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='turo_bridge_tokens'
--       AND column_name='token')                              AS plaintext_column_remaining,
--   (SELECT count(*) FROM public.turo_bridge_tokens)          AS tokens,
--   (SELECT count(*) FROM public.turo_bridge_tokens
--     WHERE token_hash ~ '^[0-9a-f]{64}$')                    AS tokens_hashed,
--   (SELECT count(*) FROM pg_policies
--     WHERE tablename LIKE 'turo_bridge%')                    AS policies;
