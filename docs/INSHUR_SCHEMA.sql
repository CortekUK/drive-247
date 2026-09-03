-- =============================================================================
-- INSHUR / ABI Period Z integration — schema
--
-- Deliberately NOT in supabase/migrations/: this project applies schema changes
-- out of band (Supabase MCP / SQL editor), and the repo's migration folder is a
-- known-inaccurate map of what is actually deployed. A file there would be
-- picked up by `supabase db push` alongside every other unapplied migration.
--
-- STRICTLY ADDITIVE. New tables, new nullable columns, one storage bucket.
-- Nothing dropped, nothing altered destructively. Safe to run twice.
-- Rollback at the bottom, commented out.
--
-- Target: DRIVE-247 / hviqoaokxvlancmftwuo
--
-- AFTER APPLYING, regenerate types — every portal INSHUR query currently routes
-- through supabaseUntyped / `as any` because these tables are absent:
--   npx supabase gen types typescript --project-id hviqoaokxvlancmftwuo \
--     > apps/portal/src/integrations/supabase/types.ts
--   cp apps/portal/src/integrations/supabase/types.ts apps/booking/src/integrations/supabase/types.ts
--   cp apps/portal/src/integrations/supabase/types.ts apps/admin/src/integrations/supabase/types.ts
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Per-tenant INSHUR configuration
--
-- inshur_mode defaults to 'mock' so every existing tenant lands in simulation
-- rather than a half-configured live state that would attempt real cover with
-- empty credentials.
-- -----------------------------------------------------------------------------

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS integration_inshur        BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inshur_mode               TEXT    DEFAULT 'mock';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inshur_username           TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inshur_password           TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inshur_customer_number    TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inshur_policy_number      TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inshur_2fa_token          TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inshur_states_allowed     JSONB   DEFAULT '[]'::jsonb;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inshur_states_synced_at   TIMESTAMPTZ;

-- Who bears the Period Z premium. A column rather than a constant because the
-- decision is still open with the team and flipping it must not be a code change.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inshur_billing_mode       TEXT    DEFAULT 'host_absorbs';

-- Escape hatch for the three ABI paths we are NOT certain about. Our own
-- 2026-05-23 discovery doc contradicts the API reference on two of them, and
-- the third was never documented at all:
--
--   states_allowed   /period-z/states-allowed/
--                    vs /customer/{CN}/policy/{PN}/period-zero/states-allowed/
--   twofactor_verify the request endpoint is documented; the verify endpoint is
--                    named in the index but its path, body, and whether it
--                    returns a reusable token are all unrecorded
--   billing_params   ?STARTDATE=&ENDDATE=  vs  ?startDate=&endDate=
--
-- Without this, each wrong guess costs a code edit and a redeploy on handover
-- day — and states-allowed is worse than that, because covered-states gates
-- go-live, so a 404 would block go-live permanently with no route out of the UI.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inshur_endpoint_overrides JSONB   DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_inshur_mode_check') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_inshur_mode_check
      CHECK (inshur_mode IN ('mock', 'test', 'live'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_inshur_billing_mode_check') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_inshur_billing_mode_check
      CHECK (inshur_billing_mode IN ('host_absorbs', 'renter_pays'));
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- 2. Vehicle garaging state
--
-- Create Rental Period requires STATE on EVERY call and no existing column
-- supplies it. Referenced by 6 source files including inshur-create-coverage,
-- which cannot resolve a state without it — so if this column is missing,
-- cover creation is dead on arrival while the eligibility badge still reads
-- healthy (eligibility only checks Period X, tracker and comp/coll).
-- -----------------------------------------------------------------------------

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS garaging_state TEXT;

-- Deliberately NOT backfilled.
--
-- `tenants` carries only a free-text `address` — there is no structured state
-- column to copy from, and parsing a two-letter code out of prose would be a
-- guess. A wrong STATE here is not cosmetic: it is printed on the renter's
-- insurance ID card and determines which filing the cover sits under, so a
-- plausible-but-wrong value is worse than an empty one.
--
-- Left NULL on purpose. inshur-eligibility-badge already treats a missing
-- garaging state as its own blocking condition, so operators are prompted per
-- vehicle instead of silently inheriting a bad default.


-- -----------------------------------------------------------------------------
-- 3. Vehicle eligibility cache
--
-- Eligibility gates every bind and only changes when the operator edits their
-- Period X policy, so caching avoids a network call per booking and lets the
-- vehicles list render badges instantly. checked_at drives staleness.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inshur_vehicle_eligibility (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  vehicle_id          UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  vin                 TEXT NOT NULL,
  eligible            BOOLEAN NOT NULL DEFAULT false,
  on_period_x         BOOLEAN NOT NULL DEFAULT false,
  has_tracking_device BOOLEAN NOT NULL DEFAULT false,
  has_comp_coll       BOOLEAN NOT NULL DEFAULT false,
  reason              TEXT,
  -- Which mode produced this answer. A row written in 'mock' must never be
  -- read as evidence that a real vehicle is really covered.
  source_mode         TEXT NOT NULL DEFAULT 'mock',
  checked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inshur_vehicle_eligibility_mode_check CHECK (source_mode IN ('mock','test','live')),
  -- Upsert target for inshur-check-eligibility.
  CONSTRAINT inshur_vehicle_eligibility_unique UNIQUE (tenant_id, vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_inshur_elig_tenant  ON inshur_vehicle_eligibility(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inshur_elig_vehicle ON inshur_vehicle_eligibility(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_inshur_elig_stale   ON inshur_vehicle_eligibility(tenant_id, checked_at);


-- -----------------------------------------------------------------------------
-- 4. Renter id cache
--
-- ABI renters persist across policy renewals, so re-adding the same person per
-- booking would duplicate them on their side. Keyed by mode because a test
-- renter id is meaningless against live credentials.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inshur_renters (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  inshur_renter_id  TEXT NOT NULL,
  source_mode       TEXT NOT NULL DEFAULT 'mock',
  -- Hash of the fields we sent. If the customer later corrects their licence
  -- number the hash changes and we re-register rather than silently insuring
  -- them against stale details.
  payload_hash      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inshur_renters_mode_check CHECK (source_mode IN ('mock','test','live')),
  -- Upsert target for the renter cache in inshur-create-coverage.
  CONSTRAINT inshur_renters_unique UNIQUE (tenant_id, customer_id, source_mode)
);

CREATE INDEX IF NOT EXISTS idx_inshur_renters_tenant   ON inshur_renters(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inshur_renters_customer ON inshur_renters(customer_id);


-- -----------------------------------------------------------------------------
-- 5. Rental coverage
--
-- One row per attempt to cover a rental. Records failures too — a rental whose
-- cover could not be created is the single most important thing an operator
-- needs to see, and a table holding only successes cannot show it.
--
-- FK constraint names are explicit: the insurances page uses
-- inshur_rental_coverage_customer_id_fkey as a PostgREST embed hint, so the
-- name is part of the contract, not an implementation detail.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inshur_rental_coverage (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  rental_id          UUID NOT NULL,
  customer_id        UUID,
  vehicle_id         UUID,

  vin                TEXT NOT NULL,
  inshur_rental_id   TEXT,
  inshur_renter_id   TEXT,

  status             TEXT NOT NULL DEFAULT 'pending',
  usage_type         TEXT NOT NULL DEFAULT 'Personal',
  state              TEXT,
  timezone           TEXT,
  -- Exactly the strings sent to ABI, retained verbatim. Recomputing them later
  -- from our own timestamps would not prove what cover was actually bought.
  start_time_sent    TEXT,
  end_time_sent      TEXT,

  has_comp_coll      BOOLEAN,
  id_card_url        TEXT,
  -- Derived from ABI's RESULT.FILETYPE, never assumed. The Period Z rental card
  -- is PNG while the sibling vehicle card is PDF, and our own discovery doc
  -- lists the format as undocumented — hardcoding it would email renters an
  -- unopenable attachment.
  id_card_file_type  TEXT,
  id_card_fetched_at TIMESTAMPTZ,

  source_mode        TEXT NOT NULL DEFAULT 'mock',
  error_code         TEXT,
  error_message      TEXT,
  attempt_count      INTEGER NOT NULL DEFAULT 0,
  last_attempt_at    TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at           TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,

  CONSTRAINT inshur_rental_coverage_tenant_id_fkey
    FOREIGN KEY (tenant_id)   REFERENCES tenants(id)   ON DELETE CASCADE,
  CONSTRAINT inshur_rental_coverage_rental_id_fkey
    FOREIGN KEY (rental_id)   REFERENCES rentals(id)   ON DELETE CASCADE,
  CONSTRAINT inshur_rental_coverage_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT inshur_rental_coverage_vehicle_id_fkey
    FOREIGN KEY (vehicle_id)  REFERENCES vehicles(id)  ON DELETE SET NULL,

  CONSTRAINT inshur_coverage_status_check CHECK (
    status IN ('pending','ineligible','active','ended','cancelled','failed')
  ),
  CONSTRAINT inshur_coverage_mode_check  CHECK (source_mode IN ('mock','test','live')),
  CONSTRAINT inshur_coverage_usage_check CHECK (usage_type IN ('Personal','Rideshare'))
);

CREATE INDEX IF NOT EXISTS idx_inshur_cov_tenant ON inshur_rental_coverage(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inshur_cov_rental ON inshur_rental_coverage(rental_id);
CREATE INDEX IF NOT EXISTS idx_inshur_cov_status ON inshur_rental_coverage(tenant_id, status);

-- THE idempotency guard. ABI exposes no idempotency key, so a double-fired
-- confirmation would buy cover twice and bill the operator twice. Terminal rows
-- are excluded so a cancelled rental can legitimately be re-covered.
-- inshur-create-coverage treats 23505 here as "already covered", not an error.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inshur_cov_one_active
  ON inshur_rental_coverage(rental_id)
  WHERE status IN ('pending','active');


-- -----------------------------------------------------------------------------
-- 6. RLS — project convention: tenant users read their own, super admins read
--    all, only service_role mutates. All writes come from edge functions.
-- -----------------------------------------------------------------------------

ALTER TABLE inshur_vehicle_eligibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE inshur_renters             ENABLE ROW LEVEL SECURITY;
ALTER TABLE inshur_rental_coverage     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant users read inshur eligibility" ON inshur_vehicle_eligibility;
CREATE POLICY "Tenant users read inshur eligibility"
  ON inshur_vehicle_eligibility FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Service role manages inshur eligibility" ON inshur_vehicle_eligibility;
CREATE POLICY "Service role manages inshur eligibility"
  ON inshur_vehicle_eligibility FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Tenant users read inshur renters" ON inshur_renters;
CREATE POLICY "Tenant users read inshur renters"
  ON inshur_renters FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Service role manages inshur renters" ON inshur_renters;
CREATE POLICY "Service role manages inshur renters"
  ON inshur_renters FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Tenant users read inshur coverage" ON inshur_rental_coverage;
CREATE POLICY "Tenant users read inshur coverage"
  ON inshur_rental_coverage FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Service role manages inshur coverage" ON inshur_rental_coverage;
CREATE POLICY "Service role manages inshur coverage"
  ON inshur_rental_coverage FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- -----------------------------------------------------------------------------
-- 7. Storage bucket for ID cards
--
-- PRIVATE, unlike gig-driver-images. An insurance ID card carries the renter's
-- full name, the VIN and the policy number; a public bucket would make every
-- card reachable by anyone who can guess a path. Served via signed URLs.
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('inshur-id-cards', 'inshur-id-cards', false, 5242880,
        ARRAY['image/png','image/jpeg','application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png','image/jpeg','application/pdf'];

DROP POLICY IF EXISTS "Service role manages inshur id cards" ON storage.objects;
CREATE POLICY "Service role manages inshur id cards"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'inshur-id-cards') WITH CHECK (bucket_id = 'inshur-id-cards');

DROP POLICY IF EXISTS "Tenant users read inshur id cards" ON storage.objects;
CREATE POLICY "Tenant users read inshur id cards"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'inshur-id-cards');


-- -----------------------------------------------------------------------------
-- 8. Verification — run after applying. Every row should report OK.
-- -----------------------------------------------------------------------------

SELECT 'tables' AS check,
       count(*) FILTER (WHERE table_name = 'inshur_vehicle_eligibility') +
       count(*) FILTER (WHERE table_name = 'inshur_renters') +
       count(*) FILTER (WHERE table_name = 'inshur_rental_coverage') AS found,
       3 AS expected
FROM information_schema.tables WHERE table_schema = 'public'
UNION ALL
-- Backslash, not brackets: Postgres LIKE escapes with \, and 'inshur[_]%'
-- (SQL Server syntax) matches nothing here — it would report 0 and read as a
-- failed apply.
SELECT 'tenant columns', count(*), 11
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tenants'
  AND (column_name LIKE 'inshur\_%' OR column_name = 'integration_inshur')
UNION ALL
SELECT 'vehicles.garaging_state', count(*), 1
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'garaging_state'
UNION ALL
SELECT 'idempotency index', count(*), 1
FROM pg_indexes WHERE indexname = 'idx_inshur_cov_one_active'
UNION ALL
SELECT 'id-card bucket', count(*), 1
FROM storage.buckets WHERE id = 'inshur-id-cards';


-- =============================================================================
-- ROLLBACK (uncomment to reverse)
-- =============================================================================
-- DROP TABLE IF EXISTS inshur_rental_coverage;
-- DROP TABLE IF EXISTS inshur_renters;
-- DROP TABLE IF EXISTS inshur_vehicle_eligibility;
-- DELETE FROM storage.buckets WHERE id = 'inshur-id-cards';
-- ALTER TABLE vehicles DROP COLUMN IF EXISTS garaging_state;
-- ALTER TABLE tenants
--   DROP COLUMN IF EXISTS integration_inshur,
--   DROP COLUMN IF EXISTS inshur_mode,
--   DROP COLUMN IF EXISTS inshur_username,
--   DROP COLUMN IF EXISTS inshur_password,
--   DROP COLUMN IF EXISTS inshur_customer_number,
--   DROP COLUMN IF EXISTS inshur_policy_number,
--   DROP COLUMN IF EXISTS inshur_2fa_token,
--   DROP COLUMN IF EXISTS inshur_states_allowed,
--   DROP COLUMN IF EXISTS inshur_states_synced_at,
--   DROP COLUMN IF EXISTS inshur_billing_mode,
--   DROP COLUMN IF EXISTS inshur_endpoint_overrides;
