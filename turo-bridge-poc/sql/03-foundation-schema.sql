-- ============================================================================
-- Drive247 Turo Bridge — FOUNDATION SCHEMA (03)
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor (runs as service_role) -> paste -> Run,
--   or mcp__supabase__apply_migration. Per the standing project convention,
--   PREFER the Supabase MCP tools over dropping a file into
--   supabase/migrations/ that the CLI would later replay.
--
--   DO NOT APPLY THIS AUTOMATICALLY. A human applies it deliberately.
--   It is idempotent and safe to re-run.
--
-- WHAT THIS EXTENDS (verified against the LIVE catalog of hviqoaokxvlancmftwuo,
-- not against the migration files, on 2026-09-02):
--   * public.turo_bridge_reservations  — EXISTS, 1 row, RLS ON, 15 columns,
--     UNIQUE (tenant_id, reservation_id) already present as
--     turo_bridge_reservations_tenant_reservation_key. NOT renamed here.
--   * public.turo_bridge_tokens        — EXISTS, 1 row, RLS ON.
--   * public.blocked_dates             — EXISTS, 239 rows, RLS **OFF**, and it
--     IS a member of the supabase_realtime publication.
--
-- ⚠ TWO LIVE FACTS THAT SHAPE THIS FILE
--
--   (1) turo-bridge-poc/sql/01-schema.sql HAS NOT BEEN APPLIED to production.
--       turo_bridge_tokens still carries a PLAINTEXT `token text NOT NULL`
--       column with a UNIQUE(token) index, and there is NO token_hash column
--       (information_schema returned 0). supabase/functions/turo-bridge-ingest/
--       index.ts:159-163 selects on `token_hash`, so ingest is currently broken
--       against production. THIS FILE DOES NOT FIX THAT — 01-schema.sql owns the
--       token table and must be applied first or alongside. This file only ADDS
--       a column to that table (turo_account_fingerprint), which is safe in
--       either shape.
--
--   (2) blocked_dates has RLS OFF and is published over realtime. Anything
--       written into blocked_dates.reason is therefore broadcast to any holder
--       of the public anon key. That is why the Turo-sourced block row below is
--       constrained to an OPAQUE reason and carries only our internal uuid —
--       never a guest name, never a Turo reservation id. Same reasoning as
--       supabase/migrations/20260822120000_fleet_health_security_and_defect_fixes.sql:115-117
--       ("Structured reason only. blocked_dates is broadcast over realtime with
--       RLS off, so the narrative stays on the job row.")
--
-- THE ONE IDEA THIS SCHEMA IS BUILT AROUND
--   ABSENCE IS NOT EVIDENCE. A degraded read — Cloudflare returning HTTP 200
--   with a valid-but-empty JSON body, an expired session, a renamed field, a
--   truncated page — yields FEWER records, and every one of those looks exactly
--   like a cancellation. If absence can drive a release, a block disappears for
--   a trip that is still real and the car is double-sold.
--
--   So: releasing anything requires POSITIVE EVIDENCE, and the evidence is a
--   *job row that the database itself judged authoritative* — never a client
--   assertion. `turo_sync_jobs.is_authoritative` and `.completeness` are
--   GENERATED ALWAYS columns: no caller, service_role included, can write them.
-- ============================================================================

BEGIN;

-- ===========================================================================
-- 0. IMMUTABLE HELPERS
--
-- Needed by GENERATED columns, which reject anything not marked IMMUTABLE.
-- ===========================================================================

-- Normalise a Turo display string down to a comparison key.
--
-- WHY THIS EXISTS: older Turo exports identify a car ONLY as a rendered string,
-- e.g. 'Owner 1 Wagoneer (Jon) (CA #9DUC203)'. There is no id in that vintage.
-- We must be able to key on it, and it must survive re-capitalisation, double
-- spaces and punctuation drift between export vintages.
--
-- It deliberately does NOT try to parse out the plate or the owner. Extracting
-- '9DUC203' and treating it as a plate is exactly the kind of silent guess this
-- project forbids; a plate lives in turo_vehicle_map.plate_hint as a HINT for a
-- human, never as a join key.
CREATE OR REPLACE FUNCTION public.turo_norm_label(p_label text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(lower(coalesce(p_label, '')), '[^a-z0-9]+', ' ', 'g'))
$$;

COMMENT ON FUNCTION public.turo_norm_label(text) IS
  'Lowercase / punctuation-stripped comparison key for a Turo vehicle or guest display string. IMMUTABLE so GENERATED columns can use it. Returns '''' (empty), never NULL.';

-- ===========================================================================
-- 1. turo_sync_jobs — ONE ROW PER SYNC RUN
--
-- This table answers three questions that the PoC could not:
--   * is this run still alive, or did it die?      (heartbeat + reaper)
--   * did we read the WHOLE feed, or a slice?      (saw_end_of_feed, generated
--                                                   completeness)
--   * what window did we actually observe?         (window_start/end +
--                                                   observed_turo_vehicle_ids)
--
-- ⚠ A PARTIAL RUN IS STRUCTURALLY INCAPABLE OF LOOKING COMPLETE.
--   `completeness` and `is_authoritative` are GENERATED ALWAYS ... STORED.
--   Postgres rejects any INSERT or UPDATE that supplies a value for them. A
--   client cannot claim completeness; it can only report the raw observations
--   (did the pagination terminate on its own? were there parse failures? was
--   the read flagged degraded?) from which the database DERIVES it.
--
--   `progress_denominator` is the same trick aimed at the progress bar. The
--   170-case review's failure mode was a bar reading `processed/total` where
--   `total` came from the same degraded feed — showing a confident 8/8 green on
--   a truncated read. Here the denominator is NULL until the run is genuinely
--   complete, so the honest UI ("8 so far, total unknown") is the one that falls
--   out of the data, and the dishonest one divides by NULL and renders nothing.
--   feed_reported_total is kept, but it is NAMED as untrusted and is never the
--   denominator.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.turo_sync_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Which pairing token (i.e. which operator machine) ran this. SET NULL rather
  -- than CASCADE: revoking a token must never erase the audit trail of what it
  -- did while it was valid.
  token_id      uuid REFERENCES public.turo_bridge_tokens(id) ON DELETE SET NULL,

  job_kind      text NOT NULL
                CHECK (job_kind IN ('trips', 'vehicles', 'guests',
                                    'earnings_csv', 'manual_single')),

  -- Mirrors turo_bridge_reservations.source. A fixture run must be
  -- distinguishable from a live one FOREVER and IN THE DATABASE; see the
  -- trigger in §5 that refuses to stamp a live reservation with a fixture job.
  source        text NOT NULL DEFAULT 'turo'
                CHECK (source IN ('turo', 'fixture')),

  state         text NOT NULL DEFAULT 'running'
                CHECK (state IN ('running', 'succeeded', 'failed', 'abandoned')),

  -- ---- RAW OBSERVATIONS (client-reported; each is a fact, not a judgement) --

  -- Did WE see the feed end — the page that returned no next cursor — with our
  -- own eyes? This is the single most important boolean in the schema. Turo
  -- returns ~200 results per page and the pagination shape is UNCONFIRMED, so a
  -- reader that stopped for any other reason (page cap, worker killed, an error
  -- it swallowed) MUST leave this false.
  saw_end_of_feed      boolean NOT NULL DEFAULT false,

  -- NULL means "not degraded". Any non-NULL value disqualifies the run from
  -- ever being authoritative. 'shape_unrecognised' is the one that matters most
  -- for a parser written against field names we have never confirmed.
  degraded_reason      text
                       CHECK (degraded_reason IS NULL OR degraded_reason IN (
                         'waf_challenge', 'waf_empty_200', 'captcha',
                         'session_expired', 'not_signed_in', 'http_error',
                         'shape_unrecognised', 'page_cap_reached',
                         'worker_killed', 'tab_closed', 'timeout',
                         'user_cancelled', 'heartbeat_lost', 'unknown')),

  http_error_count     integer NOT NULL DEFAULT 0 CHECK (http_error_count >= 0),
  parse_failure_count  integer NOT NULL DEFAULT 0 CHECK (parse_failure_count >= 0),
  pages_fetched        integer NOT NULL DEFAULT 0 CHECK (pages_fetched >= 0),
  records_seen         integer NOT NULL DEFAULT 0 CHECK (records_seen >= 0),
  records_ingested     integer NOT NULL DEFAULT 0 CHECK (records_ingested >= 0),

  -- Whatever the feed itself claimed the total was. UNTRUSTED BY NAME: a
  -- degraded read reports a degraded total, so this is a diagnostic to compare
  -- against records_seen, never a denominator.
  feed_reported_total  integer CHECK (feed_reported_total IS NULL OR feed_reported_total >= 0),

  -- ---- THE OBSERVED WINDOW ------------------------------------------------
  -- requested_* is what we ASKED for; window_* is what we can actually vouch
  -- for having read. They differ precisely when a read is truncated, and that
  -- difference is the thing a human needs to see.
  requested_window_start timestamptz,
  requested_window_end   timestamptz,
  window_start           timestamptz,
  window_end             timestamptz,

  -- Which Turo vehicles actually appeared in this read. A vehicle that never
  -- appeared cannot have its trips released by this job — silence about a car
  -- is not a statement about that car. Small by construction (a fleet, not a
  -- feed), so an array beats a child table here.
  observed_turo_vehicle_ids text[] NOT NULL DEFAULT '{}'::text[],

  -- ---- MULTI-TENANT SAFETY ------------------------------------------------
  -- One Chrome profile holds ONE Turo cookie jar but may be paired to two
  -- Drive247 tenants. Syncing tenant A's trips into tenant B is the worst
  -- outcome in this system. This is a non-PII stable digest of the Turo host
  -- account identity observed in the tab (sha256 hex). The trigger in §7 pins it
  -- to the token on first use and refuses every later mismatch.
  turo_account_fingerprint text
                       CHECK (turo_account_fingerprint IS NULL
                              OR turo_account_fingerprint ~ '^[0-9a-f]{64}$'),

  -- ---- LIVENESS -----------------------------------------------------------
  -- MV3 kills the service worker at will and nothing runs while Chrome is quit,
  -- so "started and never finished" is the NORMAL failure, not an exotic one.
  -- heartbeat_at is bumped by the client mid-run; the reaper in §8 converts a
  -- stale heartbeat into an explicit 'abandoned', which is a POSITIVE statement
  -- that the run died. Without it, a dead run is indistinguishable from a slow
  -- one and would sit forever holding the one-running-job lock below.
  started_at    timestamptz NOT NULL DEFAULT now(),
  heartbeat_at  timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,

  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- ---- DERIVED (NOT WRITABLE BY ANYONE) -----------------------------------
  completeness  text GENERATED ALWAYS AS (
                  CASE
                    WHEN state = 'running' THEN 'in_progress'
                    WHEN state = 'succeeded'
                     AND saw_end_of_feed
                     AND degraded_reason IS NULL
                     AND http_error_count = 0
                     AND parse_failure_count = 0
                     AND window_start IS NOT NULL
                     AND window_end IS NOT NULL
                    THEN 'complete'
                    ELSE 'partial'
                  END
                ) STORED,

  is_authoritative boolean GENERATED ALWAYS AS (
                  state = 'succeeded'
                  AND saw_end_of_feed
                  AND degraded_reason IS NULL
                  AND http_error_count = 0
                  AND parse_failure_count = 0
                  AND window_start IS NOT NULL
                  AND window_end IS NOT NULL
                ) STORED,

  -- NULL unless the run is genuinely complete. A progress bar that divides by
  -- this renders nothing rather than a false 100%.
  progress_denominator integer GENERATED ALWAYS AS (
                  CASE
                    WHEN state = 'succeeded'
                     AND saw_end_of_feed
                     AND degraded_reason IS NULL
                     AND http_error_count = 0
                     AND parse_failure_count = 0
                    THEN records_seen
                    ELSE NULL
                  END
                ) STORED,

  CONSTRAINT turo_sync_jobs_finished_iff_terminal
    CHECK ((state = 'running') = (finished_at IS NULL)),
  CONSTRAINT turo_sync_jobs_window_ordered
    CHECK (window_start IS NULL OR window_end IS NULL OR window_end >= window_start),
  CONSTRAINT turo_sync_jobs_requested_window_ordered
    CHECK (requested_window_start IS NULL OR requested_window_end IS NULL
           OR requested_window_end >= requested_window_start),
  -- A run cannot have ingested more than it saw.
  CONSTRAINT turo_sync_jobs_ingested_le_seen
    CHECK (records_ingested <= records_seen),
  -- A failed/abandoned run must say why. "It just stopped" is not a record.
  CONSTRAINT turo_sync_jobs_failure_needs_reason
    CHECK (state NOT IN ('failed', 'abandoned') OR degraded_reason IS NOT NULL)
);

-- Composite key so child rows can carry a TENANT-MATCHED foreign key. This is
-- the mechanism that makes "reservation in tenant B pointing at a job in tenant
-- A" unrepresentable rather than merely unlikely.
DO $$ BEGIN
  ALTER TABLE public.turo_sync_jobs
    ADD CONSTRAINT turo_sync_jobs_id_tenant_key UNIQUE (id, tenant_id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

-- At most ONE live run per (tenant, kind). Two concurrent readers of the same
-- feed interleave their pages and each concludes it saw an end it did not see.
-- The reaper is what stops a killed worker from holding this lock forever.
CREATE UNIQUE INDEX IF NOT EXISTS turo_sync_jobs_one_running_per_kind
  ON public.turo_sync_jobs (tenant_id, job_kind)
  WHERE state = 'running';

CREATE INDEX IF NOT EXISTS turo_sync_jobs_tenant_started_idx
  ON public.turo_sync_jobs (tenant_id, started_at DESC);

-- The reaper's scan path.
CREATE INDEX IF NOT EXISTS turo_sync_jobs_heartbeat_idx
  ON public.turo_sync_jobs (heartbeat_at)
  WHERE state = 'running';

-- "Which was the last job I can actually trust for this tenant?" — the single
-- hottest question in the whole release path.
CREATE INDEX IF NOT EXISTS turo_sync_jobs_authoritative_idx
  ON public.turo_sync_jobs (tenant_id, job_kind, finished_at DESC)
  WHERE is_authoritative;

COMMENT ON TABLE public.turo_sync_jobs IS
  'One row per Turo sync run. completeness/is_authoritative/progress_denominator are GENERATED — no client can assert completeness. A run with a stale heartbeat is reaped to state=abandoned.';
COMMENT ON COLUMN public.turo_sync_jobs.saw_end_of_feed IS
  'TRUE only if the reader observed the feed terminate on its own. Any other stop reason leaves this false and the run non-authoritative.';
COMMENT ON COLUMN public.turo_sync_jobs.feed_reported_total IS
  'UNTRUSTED. Whatever the feed claimed. A degraded feed reports a degraded total; never use as a progress denominator.';
COMMENT ON COLUMN public.turo_sync_jobs.observed_turo_vehicle_ids IS
  'Turo vehicle ids that actually appeared in this read. A vehicle absent from this array cannot have its blocks released by this job.';

-- ---------------------------------------------------------------------------
-- 1b. turo_sync_job_pages — the per-fetch evidence trail.
--
-- saw_end_of_feed is a claim; this table is the audit that makes the claim
-- checkable after the fact. It is also the ONLY place the classic degraded read
-- is visible: HTTP 200, valid JSON, zero records, a few hundred bytes. Without
-- the byte count and record count side by side, a WAF stub is indistinguishable
-- from an honestly empty page.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.turo_sync_job_pages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id         uuid NOT NULL,
  seq            integer NOT NULL CHECK (seq >= 0),

  requested_at   timestamptz NOT NULL DEFAULT now(),
  -- Path only. Never a full URL with a session-bearing query string.
  url_path       text,
  http_status    integer,
  byte_count     integer CHECK (byte_count IS NULL OR byte_count >= 0),
  record_count   integer CHECK (record_count IS NULL OR record_count >= 0),
  cursor_in      text,
  cursor_out     text,
  degraded_reason text,
  -- Shape only: the TOP-LEVEL KEY NAMES the page returned, so a rename is
  -- diagnosable from the database without ever storing guest data here.
  observed_keys  jsonb NOT NULL DEFAULT '[]'::jsonb,

  CONSTRAINT turo_sync_job_pages_job_tenant_fkey
    FOREIGN KEY (job_id, tenant_id)
    REFERENCES public.turo_sync_jobs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT turo_sync_job_pages_job_seq_key UNIQUE (job_id, seq)
);

CREATE INDEX IF NOT EXISTS turo_sync_job_pages_job_idx
  ON public.turo_sync_job_pages (job_id, seq);

COMMENT ON TABLE public.turo_sync_job_pages IS
  'Per-HTTP-fetch evidence for a sync run. byte_count next to record_count is what makes a WAF "HTTP 200 with an empty body" distinguishable from an honestly empty page.';

-- ===========================================================================
-- 2. turo_vehicle_map — TURO VEHICLE IDENTITY -> OUR vehicles.id
--
-- ⚠ VEHICLE IDENTITY IS THE HARDEST JOIN IN THIS PROJECT.
--   Live counts on hviqoaokxvlancmftwuo (2026-09-02): vehicles has 461 rows,
--   461 DISTINCT reg (globally unique, index vehicles_reg_key) — but only 326
--   distinct vin across 400 non-null vins. VIN COLLIDES 74 TIMES. So vin is a
--   HINT for a human eye and is NEVER a join key; that is why vin_hint is named
--   the way it is and carries no unique index.
--
--   And older Turo exports carry no id at all — only a rendered display string
--   like 'Owner 1 Wagoneer (Jon) (CA #9DUC203)'. So the key is:
--       turo vehicle id WHEN PRESENT, else the normalised display string.
--   `match_key` encodes exactly that, GENERATED, so a host upgrading their
--   export vintage (label-era -> id-era) does not orphan their mapping: the new
--   id-keyed row is added, the old label-keyed row keeps resolving history, and
--   alias_labels lets one row absorb label drift.
--
--   EVERY ROW REQUIRES A HUMAN. confirmed_by is NOT NULL. There is no code path
--   that can auto-create a mapping, because an auto-mapped car is a car that
--   gets blocked or released on someone else's trip.
-- ===========================================================================

-- Prerequisite for the tenant-matched composite FK below. 0 of 461 vehicles
-- have a NULL tenant_id, so this validates immediately.
DO $$ BEGIN
  ALTER TABLE public.vehicles
    ADD CONSTRAINT vehicles_id_tenant_key UNIQUE (id, tenant_id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.turo_vehicle_map (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Present in the modern feed; absent in the older export vintage.
  turo_vehicle_id   text,
  -- Present in both, and the ONLY identity in the older vintage.
  display_label     text,
  display_label_norm text GENERATED ALWAYS AS (public.turo_norm_label(display_label)) STORED,

  -- Label drift absorbed by an existing row rather than spawning a duplicate.
  alias_labels      text[] NOT NULL DEFAULT '{}'::text[],

  -- Turo id wins when we have it; the normalised label is the fallback identity.
  match_key         text GENERATED ALWAYS AS (
                      CASE
                        WHEN coalesce(btrim(turo_vehicle_id), '') <> ''
                          THEN 'tid:' || lower(btrim(turo_vehicle_id))
                        ELSE 'lbl:' || public.turo_norm_label(display_label)
                      END
                    ) STORED,

  vehicle_id        uuid NOT NULL,

  -- HINTS ONLY. Shown to the human doing the confirming. Never joined on.
  vin_hint          text,
  plate_hint        text,

  -- The human. NOT NULL is the whole point of this table.
  confirmed_by      uuid NOT NULL REFERENCES public.app_users(id),
  confirmed_at      timestamptz NOT NULL DEFAULT now(),
  confirmation_note text,

  first_seen_job_id uuid,
  is_active         boolean NOT NULL DEFAULT true,
  retired_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- At least one usable identity, or the row means nothing.
  CONSTRAINT turo_vehicle_map_has_identity
    CHECK (coalesce(btrim(turo_vehicle_id), '') <> ''
           OR public.turo_norm_label(display_label) <> ''),

  -- Tenant-matched. A mapping pointing at another tenant's car is not
  -- expressible.
  CONSTRAINT turo_vehicle_map_vehicle_tenant_fkey
    FOREIGN KEY (vehicle_id, tenant_id)
    REFERENCES public.vehicles (id, tenant_id) ON DELETE CASCADE,

  CONSTRAINT turo_vehicle_map_tenant_key_unique UNIQUE (tenant_id, match_key),
  CONSTRAINT turo_vehicle_map_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT turo_vehicle_map_retired_iff_inactive
    CHECK (is_active = (retired_at IS NULL))
);

-- An id-keyed row and a label-keyed row that share a label are AMBIGUOUS, and
-- so are two distinct Turo vehicles rendering to the same string. This index
-- makes the second insert FAIL LOUDLY rather than letting a silent
-- first-match-wins lookup pick one. A rejected insert is a question for a human;
-- a silent pick is a wrong car.
CREATE UNIQUE INDEX IF NOT EXISTS turo_vehicle_map_active_label_unique
  ON public.turo_vehicle_map (tenant_id, display_label_norm)
  WHERE is_active AND display_label_norm <> '';

CREATE INDEX IF NOT EXISTS turo_vehicle_map_vehicle_idx
  ON public.turo_vehicle_map (tenant_id, vehicle_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS turo_vehicle_map_alias_idx
  ON public.turo_vehicle_map USING gin (alias_labels);

COMMENT ON TABLE public.turo_vehicle_map IS
  'Human-confirmed Turo vehicle identity -> vehicles.id. Keyed on the Turo vehicle id when present, else the normalised display string, so a mapping survives an export-vintage upgrade. confirmed_by is NOT NULL by design.';
COMMENT ON COLUMN public.turo_vehicle_map.vin_hint IS
  'HINT ONLY, shown to the confirming human. vehicles.vin is NOT unique (326 distinct across 400 non-null, live 2026-09-02) — never join on it.';
COMMENT ON COLUMN public.turo_vehicle_map.plate_hint IS
  'HINT ONLY, e.g. the "CA #9DUC203" fragment of a legacy display string. vehicles.reg IS globally unique, but a fragment scraped from a rendered label is not proof — a human confirms.';

-- Note: NO unique constraint on (tenant_id, vehicle_id). A host who relisted a
-- car on Turo legitimately has two Turo identities for one of our vehicles, and
-- BOTH must map or half their trips stop resolving.

-- ===========================================================================
-- 3. turo_bridge_customers — GUEST STAGING
--
-- Turo shows a guest as 'Marcus D.' and gives no email and no phone. So the
-- normalised name is frequently the ONLY identity available, and a name is not
-- an identity: two 'Marcus D.'s are one merged customer and a privacy incident.
--
-- Therefore: an auto-match may only ever reach 'candidate'. Reaching 'confirmed'
-- requires confirmed_by, enforced by CHECK. There is no code path to a confirmed
-- customer link without a human.
-- ===========================================================================

DO $$ BEGIN
  ALTER TABLE public.customers
    ADD CONSTRAINT customers_id_tenant_key UNIQUE (id, tenant_id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.turo_bridge_customers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  turo_guest_id     text,
  display_name      text,
  display_name_norm text GENERATED ALWAYS AS (public.turo_norm_label(display_name)) STORED,

  match_key         text GENERATED ALWAYS AS (
                      CASE
                        WHEN coalesce(btrim(turo_guest_id), '') <> ''
                          THEN 'gid:' || lower(btrim(turo_guest_id))
                        ELSE 'nm:' || public.turo_norm_label(display_name)
                      END
                    ) STORED,

  -- Almost always NULL from Turo. Kept so a host-provided value has a home.
  email             text,
  phone             text,

  match_state       text NOT NULL DEFAULT 'unmatched'
                    CHECK (match_state IN ('unmatched', 'candidate', 'confirmed', 'ignored')),
  matched_customer_id uuid,
  match_basis       text
                    CHECK (match_basis IS NULL OR match_basis IN (
                      'turo_guest_id', 'email_exact', 'phone_exact',
                      'name_exact', 'name_fuzzy', 'human')),
  confirmed_by      uuid REFERENCES public.app_users(id),
  confirmed_at      timestamptz,

  -- The whole guest object as Turo gave it.
  raw               jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Keys we did NOT recognise. See §5 for why this is separate from raw.
  unmapped          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Which source key each column came from, or 'unconfirmed'.
  field_confidence  jsonb NOT NULL DEFAULT '{}'::jsonb,

  first_seen_job_id uuid,
  last_seen_job_id  uuid,
  last_seen_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT turo_bridge_customers_has_identity
    CHECK (coalesce(btrim(turo_guest_id), '') <> ''
           OR public.turo_norm_label(display_name) <> ''),

  -- A CONFIRMED link requires a human AND a target. Both, always.
  CONSTRAINT turo_bridge_customers_confirmed_needs_human
    CHECK (match_state <> 'confirmed'
           OR (matched_customer_id IS NOT NULL
               AND confirmed_by IS NOT NULL
               AND confirmed_at IS NOT NULL)),
  -- A candidate must actually point somewhere.
  CONSTRAINT turo_bridge_customers_candidate_needs_target
    CHECK (match_state <> 'candidate' OR matched_customer_id IS NOT NULL),
  -- Nothing may point at a customer while claiming to be unmatched.
  CONSTRAINT turo_bridge_customers_unmatched_has_no_target
    CHECK (match_state <> 'unmatched' OR matched_customer_id IS NULL),
  CONSTRAINT turo_bridge_customers_json_shapes
    CHECK (jsonb_typeof(raw) = 'object'
           AND jsonb_typeof(unmapped) = 'object'
           AND jsonb_typeof(field_confidence) = 'object'),

  CONSTRAINT turo_bridge_customers_tenant_key_unique UNIQUE (tenant_id, match_key),
  CONSTRAINT turo_bridge_customers_id_tenant_key UNIQUE (id, tenant_id),

  -- Tenant-matched: staging a guest in tenant A onto a customer in tenant B is
  -- not expressible.
  CONSTRAINT turo_bridge_customers_customer_tenant_fkey
    FOREIGN KEY (matched_customer_id, tenant_id)
    REFERENCES public.customers (id, tenant_id) ON DELETE SET NULL (matched_customer_id),

  CONSTRAINT turo_bridge_customers_job_tenant_fkey
    FOREIGN KEY (last_seen_job_id, tenant_id)
    REFERENCES public.turo_sync_jobs (id, tenant_id) ON DELETE SET NULL (last_seen_job_id),
  CONSTRAINT turo_bridge_customers_first_job_tenant_fkey
    FOREIGN KEY (first_seen_job_id, tenant_id)
    REFERENCES public.turo_sync_jobs (id, tenant_id) ON DELETE SET NULL (first_seen_job_id)
);

CREATE INDEX IF NOT EXISTS turo_bridge_customers_tenant_state_idx
  ON public.turo_bridge_customers (tenant_id, match_state);
CREATE INDEX IF NOT EXISTS turo_bridge_customers_name_idx
  ON public.turo_bridge_customers (tenant_id, display_name_norm);
CREATE INDEX IF NOT EXISTS turo_bridge_customers_unmapped_idx
  ON public.turo_bridge_customers USING gin (unmapped);

COMMENT ON TABLE public.turo_bridge_customers IS
  'Staged Turo guests. Turo exposes a name like "Marcus D." and no email, so a name is never sufficient to merge: match_state=confirmed requires confirmed_by (CHECK). Carries PII — RLS on, not published to realtime.';

-- ===========================================================================
-- 4. rentals composite key (for the promotion link in §5)
-- ===========================================================================
DO $$ BEGIN
  ALTER TABLE public.rentals
    ADD CONSTRAINT rentals_id_tenant_key UNIQUE (id, tenant_id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 5. turo_bridge_reservations — EXTEND THE EXISTING TABLE
--
-- The table, its columns and its UNIQUE (tenant_id, reservation_id) already
-- exist in production and are NOT renamed. Two deliberate coexistences:
--
--   * `status` (the PoC's 'synced'|'imported'|'failed') is LEFT ALONE. It is
--     the wire contract that supabase/functions/turo-bridge-ingest/index.ts:50
--     and apps/portal/src/hooks/use-turo-bridge.ts:47 already speak. The real
--     lifecycle moves to `sync_state`. Renaming `status` would break a shipped
--     edge function and a shipped hook for no gain.
--
--   * `raw` (the whole Turo object) is LEFT ALONE, and `unmapped` is ADDED
--     beside it. They are not the same thing: `raw` is everything, `unmapped` is
--     specifically the keys the parser DID NOT RECOGNISE. That distinction is
--     the requirement "must never guess silently" made queryable — you can ask
--     the database "what is Turo sending that we are dropping on the floor?"
--     with one GIN-indexed query instead of re-reading every blob.
-- ===========================================================================

ALTER TABLE public.turo_bridge_reservations
  -- ---- the state machine --------------------------------------------------
  ADD COLUMN IF NOT EXISTS sync_state text NOT NULL DEFAULT 'pending_match',
  ADD COLUMN IF NOT EXISTS state_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS state_reason text,

  -- ---- provenance: which run last SAW this row ----------------------------
  ADD COLUMN IF NOT EXISTS first_seen_job_id uuid,
  ADD COLUMN IF NOT EXISTS last_seen_job_id uuid,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS seen_count integer NOT NULL DEFAULT 0,

  -- ---- Turo's own trip state, kept apart from ours ------------------------
  ADD COLUMN IF NOT EXISTS turo_trip_status text,

  -- ---- identity of the things this trip refers to -------------------------
  ADD COLUMN IF NOT EXISTS turo_vehicle_id text,
  ADD COLUMN IF NOT EXISTS turo_guest_id text,
  ADD COLUMN IF NOT EXISTS vehicle_map_id uuid,
  ADD COLUMN IF NOT EXISTS matched_vehicle_id uuid,
  ADD COLUMN IF NOT EXISTS turo_bridge_customer_id uuid,
  ADD COLUMN IF NOT EXISTS match_basis text,

  -- ---- honest parsing -----------------------------------------------------
  ADD COLUMN IF NOT EXISTS unmapped jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS parser_version text,

  -- ---- disappearance, and the evidence for it -----------------------------
  ADD COLUMN IF NOT EXISTS missing_since timestamptz,
  ADD COLUMN IF NOT EXISTS missing_evidence_job_id uuid,
  ADD COLUMN IF NOT EXISTS missing_streak integer NOT NULL DEFAULT 0,

  -- ---- Turo moved it ------------------------------------------------------
  -- A Turo agent can move a trip to a different vehicle, or reissue it under a
  -- different reservation id. Both are renames, not cancellations, and a schema
  -- with nowhere to record them turns each into a phantom cancellation.
  ADD COLUMN IF NOT EXISTS superseded_by_reservation_id text,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS vehicle_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS previous_vehicle_map_id uuid,

  -- ---- promotion ----------------------------------------------------------
  ADD COLUMN IF NOT EXISTS promoted_rental_id uuid,
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS promoted_by uuid,

  -- ---- the availability block this row owns -------------------------------
  ADD COLUMN IF NOT EXISTS blocked_date_id uuid,

  -- ---- "completed is NOT terminal" ----------------------------------------
  -- Guests extend a trip up to 24h AFTER it ends and Turo auto-accepts, so a
  -- trip that looks finished can still grow. hold_until is maintained by a
  -- trigger (§7) as ends_at + 48h, and the trigger ALWAYS overwrites whatever
  -- the client sent, so nobody can shorten the hold. hold_override_until only
  -- ever extends it.
  --
  -- (It is a trigger-maintained column and not GENERATED because
  -- timestamptz + interval is STABLE, not IMMUTABLE, and Postgres rejects it in
  -- a generation expression.)
  ADD COLUMN IF NOT EXISTS hold_until timestamptz,
  ADD COLUMN IF NOT EXISTS hold_override_until timestamptz,

  -- ---- human overrides ----------------------------------------------------
  ADD COLUMN IF NOT EXISTS ignored_by uuid,
  ADD COLUMN IF NOT EXISTS ignored_at timestamptz,
  ADD COLUMN IF NOT EXISTS ignore_reason text,

  ADD COLUMN IF NOT EXISTS turo_account_fingerprint text;

-- Composite key on the table itself, so other Turo tables can point at a
-- reservation with a tenant-matched FK.
DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_id_tenant_key UNIQUE (id, tenant_id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

-- ---- 5a. The state machine, as a constraint -------------------------------
DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_sync_state_check
    CHECK (sync_state IN ('pending_match', 'staged', 'promoted',
                          'cancellation_candidate', 'conflict', 'ignored'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ⚠ THE CENTRAL SAFETY CONSTRAINT.
-- A row may only claim to be a cancellation candidate if it CARRIES THE
-- EVIDENCE: a specific job that looked and did not find it. Silence cannot
-- satisfy this — there is no value of missing_evidence_job_id meaning "nothing
-- came back". §7's trigger then additionally proves that job was authoritative,
-- covered this vehicle, and covered this window.
DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_cancellation_needs_evidence
    CHECK (sync_state <> 'cancellation_candidate'
           OR (missing_evidence_job_id IS NOT NULL AND missing_since IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_promoted_needs_rental
    CHECK (sync_state <> 'promoted' OR promoted_rental_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_ignored_needs_human
    CHECK (sync_state <> 'ignored' OR (ignored_by IS NOT NULL AND ignored_at IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 'staged' means "ready to promote", which requires knowing WHICH CAR. Without
-- this, a staged row with no vehicle silently becomes a tenant-wide block later.
DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_staged_needs_vehicle
    CHECK (sync_state NOT IN ('staged', 'promoted')
           OR (matched_vehicle_id IS NOT NULL AND vehicle_map_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_json_shapes
    CHECK (jsonb_typeof(unmapped) = 'object'
           AND jsonb_typeof(field_confidence) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_match_basis_check
    CHECK (match_basis IS NULL OR match_basis IN (
      'turo_vehicle_id', 'label_exact', 'label_alias', 'human'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_fingerprint_valid
    CHECK (turo_account_fingerprint IS NULL
           OR turo_account_fingerprint ~ '^[0-9a-f]{64}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- NOT VALID: these touch the one pre-existing production row, whose shape we do
-- not control. They are enforced for every future write from this moment, which
-- is what matters; validating the backlog is a separate, deliberate step
-- (see the VALIDATE lines at the foot of this file).
DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_reservation_id_nonblank
    CHECK (btrim(reservation_id) <> '' AND char_length(reservation_id) <= 200) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_dates_ordered
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- 5b. Tenant-matched foreign keys --------------------------------------
-- Every one of these makes a cross-tenant reference UNREPRESENTABLE rather than
-- merely discouraged: tenant_id is part of the key on BOTH sides, so Postgres
-- refuses the row and there is no application check to forget.
--
-- `ON DELETE SET NULL (col)` — the PG15+ column-list form, and it is load-bearing
-- here (server is PostgreSQL 17.6). A bare composite ON DELETE SET NULL nulls
-- EVERY referencing column, tenant_id included, and tenant_id is NOT NULL — so
-- deleting a sync job would abort with a not-null violation instead of clearing
-- the pointer.
DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_last_job_tenant_fkey
    FOREIGN KEY (last_seen_job_id, tenant_id)
    REFERENCES public.turo_sync_jobs (id, tenant_id) ON DELETE SET NULL (last_seen_job_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_first_job_tenant_fkey
    FOREIGN KEY (first_seen_job_id, tenant_id)
    REFERENCES public.turo_sync_jobs (id, tenant_id) ON DELETE SET NULL (first_seen_job_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_missing_job_tenant_fkey
    FOREIGN KEY (missing_evidence_job_id, tenant_id)
    REFERENCES public.turo_sync_jobs (id, tenant_id) ON DELETE SET NULL (missing_evidence_job_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_vehicle_map_tenant_fkey
    FOREIGN KEY (vehicle_map_id, tenant_id)
    REFERENCES public.turo_vehicle_map (id, tenant_id) ON DELETE SET NULL (vehicle_map_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_matched_vehicle_tenant_fkey
    FOREIGN KEY (matched_vehicle_id, tenant_id)
    REFERENCES public.vehicles (id, tenant_id) ON DELETE SET NULL (matched_vehicle_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_guest_tenant_fkey
    FOREIGN KEY (turo_bridge_customer_id, tenant_id)
    REFERENCES public.turo_bridge_customers (id, tenant_id) ON DELETE SET NULL (turo_bridge_customer_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- promoted_rental_id is a SINGLE-column FK on purpose. A composite FK with
-- ON DELETE SET NULL would null BOTH columns — including tenant_id, which is
-- NOT NULL — and the delete would explode. The tenant match is enforced by the
-- trigger in §7 instead, which also demotes the row to 'conflict' rather than
-- violating the promoted_needs_rental CHECK when a rental is deleted underneath
-- it. (BEFORE triggers run before CHECK evaluation, so the demotion lands.)
DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_promoted_rental_fkey
    FOREIGN KEY (promoted_rental_id)
    REFERENCES public.rentals (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_promoted_by_fkey
    FOREIGN KEY (promoted_by) REFERENCES public.app_users (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_ignored_by_fkey
    FOREIGN KEY (ignored_by) REFERENCES public.app_users (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- blocked_date_id is added as a plain FK in §6, after the guard columns exist.

CREATE INDEX IF NOT EXISTS turo_bridge_reservations_tenant_state_idx
  ON public.turo_bridge_reservations (tenant_id, sync_state);
CREATE INDEX IF NOT EXISTS turo_bridge_reservations_last_job_idx
  ON public.turo_bridge_reservations (last_seen_job_id);
CREATE INDEX IF NOT EXISTS turo_bridge_reservations_turo_vehicle_idx
  ON public.turo_bridge_reservations (tenant_id, turo_vehicle_id);
CREATE INDEX IF NOT EXISTS turo_bridge_reservations_hold_idx
  ON public.turo_bridge_reservations (tenant_id, hold_until)
  WHERE sync_state IN ('staged', 'promoted');
-- "What is Turo sending that we do not understand?" in one query.
CREATE INDEX IF NOT EXISTS turo_bridge_reservations_unmapped_idx
  ON public.turo_bridge_reservations USING gin (unmapped);

COMMENT ON COLUMN public.turo_bridge_reservations.sync_state IS
  'OUR lifecycle: pending_match -> staged -> promoted, with cancellation_candidate / conflict / ignored. Distinct from the legacy PoC `status` column (kept for the shipped edge function + hook) and from Turo''s own turo_trip_status.';
COMMENT ON COLUMN public.turo_bridge_reservations.unmapped IS
  'Keys present in the Turo payload that the parser did not recognise. Separate from `raw` (which is everything) so an unrecognised field is queryable, not merely preserved. Every field name in this feed is unconfirmed — we have no Turo host account.';
COMMENT ON COLUMN public.turo_bridge_reservations.field_confidence IS
  'Per-column provenance: which source key each mapped column came from, or "unconfirmed". This is how the UI shows a guess AS a guess.';
COMMENT ON COLUMN public.turo_bridge_reservations.hold_until IS
  'ends_at + 48h, ALWAYS overwritten by trigger. "completed" is not terminal: guests extend up to 24h after a trip ends and Turo auto-accepts. Nothing may be released before this.';
COMMENT ON COLUMN public.turo_bridge_reservations.missing_evidence_job_id IS
  'The authoritative job that looked for this reservation and did not find it. Required for cancellation_candidate. Absence can never supply this value — that is the point.';

-- ===========================================================================
-- 6. blocked_dates — THE DANGEROUS TABLE
--
-- Live shape (2026-09-02): 239 rows; tenant_id NULLABLE (0 null); vehicle_id
-- NULLABLE (4 null); RLS OFF; published to supabase_realtime; source_type
-- CHECK currently ('manual','maintenance','swap').
--
-- ⚠ vehicle_id NULL MEANS A TENANT-WIDE BLOCK. One Turo-sourced row with a NULL
--   vehicle_id takes an ENTIRE FLEET off sale. That is the single highest-blast-
--   radius mistake available in this integration, and the CHECK below makes it
--   unrepresentable for Turo rows specifically — leaving the existing 4
--   deliberate manual fleet-wide blocks untouched.
--
-- ⚠ DATE vs TIMESTAMP. blocked_dates is DATE-only with an INCLUSIVE end
--   (constraint valid_date_range: end_date >= start_date; the maintenance
--   EXCLUDE uses daterange(start,end,'[]')). Turo trips are timestamps. So a
--   trip ending 10:00 on the 4th and one starting 16:00 on the 4th BOTH occupy
--   the 4th, and their blocks legitimately overlap. That is why NO exclusion
--   constraint is added for source_type='turo': a same-day turnaround is normal
--   operation, and an EXCLUDE would silently reject the second real block.
-- ===========================================================================

-- 6a. Teach source_type about Turo, without disturbing the three live values.
ALTER TABLE public.blocked_dates DROP CONSTRAINT IF EXISTS blocked_dates_source_type_check;
ALTER TABLE public.blocked_dates
  ADD CONSTRAINT blocked_dates_source_type_check
  CHECK (source_type IN ('manual', 'maintenance', 'swap', 'turo'));

-- 6b. Provenance columns.
ALTER TABLE public.blocked_dates
  ADD COLUMN IF NOT EXISTS turo_reservation_uid uuid,
  ADD COLUMN IF NOT EXISTS turo_job_id uuid;

DO $$ BEGIN
  ALTER TABLE public.blocked_dates
    ADD CONSTRAINT blocked_dates_turo_reservation_fkey
    FOREIGN KEY (turo_reservation_uid)
    REFERENCES public.turo_bridge_reservations (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.blocked_dates
    ADD CONSTRAINT blocked_dates_turo_job_fkey
    FOREIGN KEY (turo_job_id)
    REFERENCES public.turo_sync_jobs (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6c. ⚠ THE CONSTRAINT THE 170-CASE REVIEW ASKED FOR.
-- A Turo-sourced block MUST name a vehicle and a tenant, and MUST carry the
-- staging row it came from. NULL vehicle_id on a Turo row is now a database
-- error, not a fleet outage.
DO $$ BEGIN
  ALTER TABLE public.blocked_dates
    ADD CONSTRAINT blocked_dates_turo_requires_vehicle
    CHECK (source_type <> 'turo'
           OR (vehicle_id IS NOT NULL
               AND tenant_id IS NOT NULL
               AND turo_reservation_uid IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6d. No guest data on the public wire.
-- This table has RLS OFF and IS published to realtime, so `reason` reaches any
-- holder of the anon key. A Turo row's narrative stays on the staging row; the
-- block carries an opaque marker and our internal uuid only.
DO $$ BEGIN
  ALTER TABLE public.blocked_dates
    ADD CONSTRAINT blocked_dates_turo_reason_is_opaque
    CHECK (source_type <> 'turo'
           OR (coalesce(reason, 'Turo trip') = 'Turo trip'
               AND coalesce(reason_code, 'turo_trip') = 'turo_trip'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6e. Now that the guard columns exist, link the staging row to its block.
DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_blocked_date_fkey
    FOREIGN KEY (blocked_date_id)
    REFERENCES public.blocked_dates (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS blocked_dates_turo_reservation_idx
  ON public.blocked_dates (turo_reservation_uid)
  WHERE turo_reservation_uid IS NOT NULL;

COMMENT ON COLUMN public.blocked_dates.turo_reservation_uid IS
  'Our internal turo_bridge_reservations.id — deliberately NOT the Turo reservation id and never a guest name: this table has RLS off and is broadcast over realtime.';

-- ===========================================================================
-- 7. TRIGGERS — the rules a CHECK cannot express
-- ===========================================================================

-- ---- 7a. updated_at on the new tables (house helper: public.set_updated_at) --
DROP TRIGGER IF EXISTS set_turo_sync_jobs_updated_at ON public.turo_sync_jobs;
CREATE TRIGGER set_turo_sync_jobs_updated_at
  BEFORE UPDATE ON public.turo_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_turo_vehicle_map_updated_at ON public.turo_vehicle_map;
CREATE TRIGGER set_turo_vehicle_map_updated_at
  BEFORE UPDATE ON public.turo_vehicle_map
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_turo_bridge_customers_updated_at ON public.turo_bridge_customers;
CREATE TRIGGER set_turo_bridge_customers_updated_at
  BEFORE UPDATE ON public.turo_bridge_customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The reservations table already carries an updated_at trigger in production.

-- ---- 7b. Sync jobs: terminal states are immutable; identity is pinned ------
CREATE OR REPLACE FUNCTION public.turo_sync_jobs_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pinned text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Tenant is identity. It never moves.
    IF NEW.tenant_id <> OLD.tenant_id THEN
      RAISE EXCEPTION 'turo_sync_jobs.tenant_id is immutable (job %)', OLD.id
        USING ERRCODE = '23514';
    END IF;

    -- A finished run is a historical record. Letting a later write flip
    -- saw_end_of_feed to true, or clear degraded_reason, would retroactively
    -- manufacture the authority to delete blocks — which is exactly the
    -- capability this schema exists to withhold.
    IF OLD.state <> 'running' THEN
      IF NEW.state IS DISTINCT FROM OLD.state
         OR NEW.saw_end_of_feed IS DISTINCT FROM OLD.saw_end_of_feed
         OR NEW.degraded_reason IS DISTINCT FROM OLD.degraded_reason
         OR NEW.http_error_count IS DISTINCT FROM OLD.http_error_count
         OR NEW.parse_failure_count IS DISTINCT FROM OLD.parse_failure_count
         OR NEW.records_seen IS DISTINCT FROM OLD.records_seen
         OR NEW.records_ingested IS DISTINCT FROM OLD.records_ingested
         OR NEW.window_start IS DISTINCT FROM OLD.window_start
         OR NEW.window_end IS DISTINCT FROM OLD.window_end
         OR NEW.observed_turo_vehicle_ids IS DISTINCT FROM OLD.observed_turo_vehicle_ids
      THEN
        RAISE EXCEPTION
          'turo_sync_jobs % is terminal (state=%): its evidence columns are immutable. Start a new job.',
          OLD.id, OLD.state
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  -- ⚠ MULTI-TENANT: one Chrome profile, one Turo cookie jar, possibly two
  -- Drive247 tenants. The first fingerprint a token sees is PINNED to that
  -- token; every later run through that token must match. This is what stops
  -- tenant A's trips landing in tenant B when an operator swaps Turo accounts
  -- in the same browser and forgets to swap the pairing token.
  IF NEW.turo_account_fingerprint IS NOT NULL AND NEW.token_id IS NOT NULL THEN
    SELECT turo_account_fingerprint INTO v_pinned
      FROM public.turo_bridge_tokens WHERE id = NEW.token_id FOR UPDATE;

    IF v_pinned IS NULL THEN
      UPDATE public.turo_bridge_tokens
         SET turo_account_fingerprint = NEW.turo_account_fingerprint
       WHERE id = NEW.token_id;
    ELSIF v_pinned <> NEW.turo_account_fingerprint THEN
      RAISE EXCEPTION
        'Turo account mismatch for this pairing token. This browser is signed into a different Turo account than the one this token was paired with. Refusing to sync — mint a token for the correct tenant instead.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- The token table needs somewhere to keep the pin. Safe against BOTH shapes of
-- turo_bridge_tokens (the live plaintext one and the hashed one 01-schema.sql
-- introduces).
ALTER TABLE public.turo_bridge_tokens
  ADD COLUMN IF NOT EXISTS turo_account_fingerprint text;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_tokens
    ADD CONSTRAINT turo_bridge_tokens_fingerprint_valid
    CHECK (turo_account_fingerprint IS NULL
           OR turo_account_fingerprint ~ '^[0-9a-f]{64}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS turo_sync_jobs_guard_trg ON public.turo_sync_jobs;
CREATE TRIGGER turo_sync_jobs_guard_trg
  BEFORE INSERT OR UPDATE ON public.turo_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION public.turo_sync_jobs_guard();

-- ---- 7c. Reservations: identity, hold, state machine, evidence ------------
CREATE OR REPLACE FUNCTION public.turo_bridge_reservations_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job              record;
  v_turo_vehicle_id  text;
  v_rental_tenant    uuid;
  v_allowed          text[];
  -- Every OLD reference below lives inside an `IF TG_OP = 'UPDATE'` block and
  -- these flags carry the result out. plpgsql evaluates an IF condition as one
  -- SQL expression and Postgres does NOT guarantee left-to-right short-circuit
  -- of AND/OR, so `TG_OP = 'UPDATE' AND OLD.x ...` can evaluate OLD.x during an
  -- INSERT and fail with "record old is not assigned yet". Nesting is the only
  -- form that is actually safe.
  v_entering_cancel  boolean := false;
  v_state_changed    boolean := false;
BEGIN
  -- ---- the 48h hold. Always recomputed; never shortenable. ----------------
  NEW.hold_until := GREATEST(NEW.ends_at + interval '48 hours', NEW.hold_override_until);

  IF TG_OP = 'UPDATE' THEN
    -- identity is immutable
    IF NEW.tenant_id <> OLD.tenant_id THEN
      RAISE EXCEPTION 'turo_bridge_reservations.tenant_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.reservation_id <> OLD.reservation_id THEN
      RAISE EXCEPTION
        'reservation_id is immutable. A trip reissued under a new id is a NEW row plus superseded_by_reservation_id on the old one — never an in-place rename, which would silently retarget an existing availability block.'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.hold_override_until IS NOT NULL THEN
      IF NEW.hold_override_until IS NULL
         OR NEW.hold_override_until < OLD.hold_override_until THEN
        RAISE EXCEPTION 'hold_override_until may only be extended, never shortened'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    -- A rental deleted underneath us arrives here as the FK's SET NULL update.
    -- Demote rather than explode: an auditable conflict beats either a hard
    -- failure on an unrelated delete, or a row still claiming to be promoted.
    -- (BEFORE triggers run before CHECK evaluation, so this demotion lands
    -- before turo_bridge_reservations_promoted_needs_rental is tested.)
    IF OLD.promoted_rental_id IS NOT NULL
       AND NEW.promoted_rental_id IS NULL
       AND NEW.sync_state = 'promoted' THEN
      NEW.sync_state   := 'conflict';
      NEW.state_reason := 'promoted rental was deleted';
    END IF;

    -- Same shape for the evidence job. If the job that justified a
    -- cancellation_candidate is deleted (retention, tenant teardown), its FK
    -- nulls the pointer — and a cancellation_candidate WITHOUT evidence is
    -- exactly the state this schema exists to forbid. Demote to 'conflict' so a
    -- human looks, rather than aborting an unrelated delete, and rather than
    -- letting an evidence-free candidate survive to justify a release.
    IF OLD.missing_evidence_job_id IS NOT NULL
       AND NEW.missing_evidence_job_id IS NULL
       AND NEW.sync_state = 'cancellation_candidate' THEN
      NEW.sync_state   := 'conflict';
      NEW.state_reason := 'evidence job was deleted; cancellation is no longer supported by any read';
    END IF;

    v_state_changed := (NEW.sync_state IS DISTINCT FROM OLD.sync_state);
    v_entering_cancel := (NEW.sync_state = 'cancellation_candidate')
                         AND (OLD.sync_state IS DISTINCT FROM 'cancellation_candidate');
  ELSE
    v_entering_cancel := (NEW.sync_state = 'cancellation_candidate');
  END IF;

  -- ---- a fixture job can never stamp a live reservation -------------------
  IF NEW.last_seen_job_id IS NOT NULL THEN
    SELECT * INTO v_job FROM public.turo_sync_jobs WHERE id = NEW.last_seen_job_id;
    IF v_job.source = 'fixture' AND NEW.source <> 'fixture' THEN
      RAISE EXCEPTION
        'Reservation % is labelled source=% but was last seen by a FIXTURE job. Demo data must never be indistinguishable from a real booking.',
        NEW.reservation_id, NEW.source
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- ---- promotion must point at OUR tenant's rental ------------------------
  IF NEW.promoted_rental_id IS NOT NULL THEN
    SELECT tenant_id INTO v_rental_tenant FROM public.rentals WHERE id = NEW.promoted_rental_id;
    IF v_rental_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'promoted_rental_id belongs to a different tenant' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- ---- the state machine --------------------------------------------------
  IF v_state_changed THEN
    v_allowed := CASE OLD.sync_state
      WHEN 'pending_match'          THEN ARRAY['staged','conflict','ignored']
      WHEN 'staged'                 THEN ARRAY['promoted','cancellation_candidate','conflict','ignored','pending_match']
      -- Never back to staged: a promoted row owns a real rental.
      WHEN 'promoted'               THEN ARRAY['cancellation_candidate','conflict']
      -- It came back. That IS positive evidence, and it must be able to return.
      WHEN 'cancellation_candidate' THEN ARRAY['staged','promoted','conflict','ignored']
      WHEN 'conflict'               THEN ARRAY['pending_match','staged','promoted','ignored']
      WHEN 'ignored'                THEN ARRAY['pending_match']
      ELSE ARRAY[]::text[]
    END;

    IF NOT (NEW.sync_state = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'Illegal Turo sync_state transition % -> % (reservation %)',
        OLD.sync_state, NEW.sync_state, NEW.reservation_id
        USING ERRCODE = '23514';
    END IF;

    NEW.state_changed_at := now();
  END IF;

  -- ---- ⚠ THE RELEASE GATE -------------------------------------------------
  -- Entering cancellation_candidate demands POSITIVE evidence, and the database
  -- verifies it rather than trusting the caller:
  --   1. the evidence job is AUTHORITATIVE  (generated column; unforgeable)
  --   2. it belongs to THIS tenant
  --   3. it actually OBSERVED this vehicle  (silence about a car is not a
  --      statement about that car)
  --   4. its observed window COVERS this trip
  --   5. the 48h post-trip extension hold has expired
  IF v_entering_cancel THEN
    SELECT * INTO v_job FROM public.turo_sync_jobs WHERE id = NEW.missing_evidence_job_id;

    IF v_job.id IS NULL THEN
      RAISE EXCEPTION 'cancellation_candidate requires a real evidence job' USING ERRCODE = '23514';
    END IF;
    IF v_job.tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'evidence job belongs to a different tenant' USING ERRCODE = '23514';
    END IF;
    IF NOT v_job.is_authoritative THEN
      RAISE EXCEPTION
        'Job % is not authoritative (completeness=%, degraded_reason=%). A degraded or partial read returns fewer records, which is indistinguishable from a cancellation. Refusing.',
        v_job.id, v_job.completeness, coalesce(v_job.degraded_reason, 'none')
        USING ERRCODE = '23514';
    END IF;

    v_turo_vehicle_id := coalesce(
      NEW.turo_vehicle_id,
      (SELECT m.turo_vehicle_id FROM public.turo_vehicle_map m WHERE m.id = NEW.vehicle_map_id));

    IF v_turo_vehicle_id IS NULL
       OR NOT (v_turo_vehicle_id = ANY (v_job.observed_turo_vehicle_ids)) THEN
      RAISE EXCEPTION
        'Job % never observed Turo vehicle % — it cannot testify that this trip is gone.',
        v_job.id, coalesce(v_turo_vehicle_id, '(unknown)')
        USING ERRCODE = '23514';
    END IF;

    IF NEW.starts_at IS NULL OR NEW.ends_at IS NULL
       OR v_job.window_start IS NULL OR v_job.window_end IS NULL
       OR NEW.starts_at < v_job.window_start OR NEW.ends_at > v_job.window_end THEN
      RAISE EXCEPTION
        'Trip window [%, %] is not fully inside the window job % actually read [%, %].',
        NEW.starts_at, NEW.ends_at, v_job.id, v_job.window_start, v_job.window_end
        USING ERRCODE = '23514';
    END IF;

    IF NEW.hold_until IS NOT NULL AND now() < NEW.hold_until THEN
      RAISE EXCEPTION
        'Held until % — a guest can extend up to 24h after a trip ends and Turo auto-accepts, so "completed" is not terminal.',
        NEW.hold_until
        USING ERRCODE = '23514';
    END IF;

    NEW.missing_since := coalesce(NEW.missing_since, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS turo_bridge_reservations_guard_trg ON public.turo_bridge_reservations;
CREATE TRIGGER turo_bridge_reservations_guard_trg
  BEFORE INSERT OR UPDATE ON public.turo_bridge_reservations
  FOR EACH ROW EXECUTE FUNCTION public.turo_bridge_reservations_guard();

-- ---- 7d. blocked_dates: a Turo block cannot be deleted casually -----------
-- Deletion IS how a block is released, so this is the last line of defence
-- against "absence deleted it". A DELETE of a source_type='turo' row is refused
-- unless the session carries release evidence, which only
-- public.turo_release_block() sets — and only after re-proving authority.
CREATE OR REPLACE FUNCTION public.turo_blocked_dates_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_evidence text;
BEGIN
  IF OLD.source_type <> 'turo' THEN
    RETURN OLD;  -- manual / maintenance / swap blocks are none of our business
  END IF;

  v_evidence := current_setting('drive247.turo_release_evidence', true);
  IF v_evidence IS NULL OR v_evidence = '' THEN
    RAISE EXCEPTION
      'Refusing to delete a Turo-sourced block directly. Availability is released only through public.turo_release_block(block_id, job_id), which requires an authoritative job as positive evidence. A trip missing from a degraded read is not a cancellation.'
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS turo_blocked_dates_delete_guard_trg ON public.blocked_dates;
CREATE TRIGGER turo_blocked_dates_delete_guard_trg
  BEFORE DELETE ON public.blocked_dates
  FOR EACH ROW EXECUTE FUNCTION public.turo_blocked_dates_delete_guard();

-- ===========================================================================
-- 8. OPERATIONS — the reaper and the release path
-- ===========================================================================

-- ---- 8a. The reaper -------------------------------------------------------
-- MV3 kills the service worker at will and nothing runs while Chrome is quit,
-- so "started, never finished" is routine. This converts a stale heartbeat into
-- an EXPLICIT 'abandoned' — a positive statement that the run died — which both
-- frees the one-running-job lock and guarantees the run can never later be
-- mistaken for authoritative.
CREATE OR REPLACE FUNCTION public.turo_reap_stale_sync_jobs(
  p_stale_after interval DEFAULT interval '5 minutes'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH reaped AS (
    UPDATE public.turo_sync_jobs
       SET state           = 'abandoned',
           finished_at     = now(),
           degraded_reason = coalesce(degraded_reason, 'heartbeat_lost'),
           notes           = coalesce(notes || E'\n', '') ||
                             'Reaped at ' || now()::text ||
                             ' after ' || p_stale_after::text || ' without a heartbeat.'
     WHERE state = 'running'
       AND heartbeat_at < now() - p_stale_after
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM reaped;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.turo_reap_stale_sync_jobs(interval) IS
  'Marks running sync jobs with a stale heartbeat as abandoned. Scheduling is pg_cron, arranged separately and deliberately — see the commented cron.schedule at the foot of this file.';

-- ---- 8b. The ONLY sanctioned way to release a Turo block ------------------
CREATE OR REPLACE FUNCTION public.turo_release_block(
  p_block_id uuid,
  p_job_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_block record;
  v_job   record;
  v_res   record;
  v_turo_vehicle_id text;
BEGIN
  SELECT * INTO v_block FROM public.blocked_dates WHERE id = p_block_id;
  IF v_block.id IS NULL THEN
    RETURN false;  -- already gone; releasing twice is not an error
  END IF;
  IF v_block.source_type <> 'turo' THEN
    RAISE EXCEPTION 'turo_release_block only releases source_type=turo blocks' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_job FROM public.turo_sync_jobs WHERE id = p_job_id;
  -- ⚠ observed_complete, NOT is_authoritative.
  --
  -- These two predicates differ by exactly one term — `parsed_count > 0`, the
  -- LIVENESS PROOF (§10) — and that one term is the whole defence against the
  -- WAF case. is_authoritative is derived from the SHAPE of the run: succeeded,
  -- saw the end of the feed, no degraded reason, no HTTP errors, no parse
  -- failures, a window on both ends. Every one of those can hold while the run
  -- read NOTHING: turo.com answers the trips feed HTTP 200 with a valid but
  -- empty body, the walk terminates on its own because an empty page carries no
  -- next link, and /api/vehicles/me answers normally so observed_turo_vehicle_ids
  -- is fully populated and the vehicle-observation check below passes too.
  --
  -- Gating on is_authoritative therefore let a run that positively parsed ZERO
  -- reservations delete a block — absence releasing a car, through the one door
  -- built to stop exactly that. observed_complete is is_authoritative AND
  -- parsed_count > 0, so only a read that demonstrably saw OTHER trips can cast
  -- doubt on this one.
  IF v_job.id IS NULL OR NOT v_job.observed_complete THEN
    RAISE EXCEPTION
      'Release requires a job that COMPLETED AND POSITIVELY READ TRIPS. Job % is % and parsed % reservations. A run that parsed nothing cannot distinguish "this trip is gone" from "we were not shown anything".',
      p_job_id, coalesce(v_job.completeness, 'missing'), coalesce(v_job.parsed_count, 0)
      USING ERRCODE = '23514';
  END IF;
  IF v_job.tenant_id <> v_block.tenant_id THEN
    RAISE EXCEPTION 'Evidence job belongs to a different tenant' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_res FROM public.turo_bridge_reservations WHERE id = v_block.turo_reservation_uid;
  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'Block % has no staging row to justify its release', p_block_id USING ERRCODE = '23514';
  END IF;
  IF v_res.sync_state <> 'cancellation_candidate' THEN
    RAISE EXCEPTION
      'Reservation % is in state %, not cancellation_candidate. Move it there first — that path carries the evidence checks.',
      v_res.reservation_id, v_res.sync_state
      USING ERRCODE = '23514';
  END IF;
  IF v_res.hold_until IS NOT NULL AND now() < v_res.hold_until THEN
    RAISE EXCEPTION 'Still inside the 48h post-trip extension hold (until %)', v_res.hold_until
      USING ERRCODE = '23514';
  END IF;

  v_turo_vehicle_id := coalesce(
    v_res.turo_vehicle_id,
    (SELECT m.turo_vehicle_id FROM public.turo_vehicle_map m WHERE m.id = v_res.vehicle_map_id));
  IF v_turo_vehicle_id IS NULL
     OR NOT (v_turo_vehicle_id = ANY (v_job.observed_turo_vehicle_ids)) THEN
    RAISE EXCEPTION 'Job % never observed this vehicle; it cannot justify a release', p_job_id USING ERRCODE = '23514';
  END IF;

  -- The block's dates must sit inside what the job actually read.
  IF v_job.window_start IS NULL OR v_job.window_end IS NULL
     OR v_block.start_date < (v_job.window_start AT TIME ZONE 'UTC')::date
     OR v_block.end_date   > (v_job.window_end   AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION
      'Block window [%, %] is outside the window job % actually read.',
      v_block.start_date, v_block.end_date, p_job_id
      USING ERRCODE = '23514';
  END IF;

  -- Local to this transaction only. This is the token the DELETE guard checks.
  PERFORM set_config('drive247.turo_release_evidence', p_job_id::text, true);
  DELETE FROM public.blocked_dates WHERE id = p_block_id;
  PERFORM set_config('drive247.turo_release_evidence', '', true);

  UPDATE public.turo_bridge_reservations
     SET blocked_date_id = NULL,
         state_reason    = 'block released on evidence from job ' || p_job_id::text
   WHERE id = v_res.id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.turo_release_block(uuid, uuid) IS
  'The ONLY sanctioned path that removes a Turo-sourced availability block. Re-proves job authority, vehicle observation, window coverage and the 48h hold before deleting. Service-role only.';

REVOKE ALL ON FUNCTION public.turo_reap_stale_sync_jobs(interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.turo_release_block(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.turo_reap_stale_sync_jobs(interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.turo_release_block(uuid, uuid) TO service_role;

-- ===========================================================================
-- 9. RLS + GRANTS
--
-- Policy shape copied VERBATIM from the house pattern in
-- supabase/migrations/20260820120000_add_web_push.sql:132-139 — a tenant-scoped
-- SELECT for `authenticated` plus an explicit service_role FOR ALL. Super
-- admins carry tenant_id = NULL by design, which is why is_super_admin() is
-- ORed rather than compared. Identical to the shape already live on
-- turo_bridge_reservations.
--
-- Writes are service_role ONLY, everywhere. The portal is read-only over all of
-- these; every mutation goes through an edge function. And the table-level
-- REVOKE matters independently of RLS: PostgREST checks the grant first, and a
-- table with a SELECT-only policy still permits writes for which no policy
-- exists if the grant is left in place (the defect fixed in
-- turo-bridge-poc/sql/01-schema.sql for the reservations table).
-- ===========================================================================

ALTER TABLE public.turo_sync_jobs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turo_sync_job_pages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turo_vehicle_map         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turo_bridge_customers    ENABLE ROW LEVEL SECURITY;
-- turo_bridge_reservations already has RLS enabled in production.
ALTER TABLE public.turo_bridge_reservations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['turo_sync_jobs', 'turo_sync_job_pages',
                           'turo_vehicle_map', 'turo_bridge_customers']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_own_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())',
      t || '_select_own_tenant', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_role_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t || '_service_role_all', t);

    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- Re-assert the reservations grants. Harmless if 01-schema.sql already did it,
-- essential if it has not been applied (it has not, as of 2026-09-02).
REVOKE ALL ON public.turo_bridge_reservations FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
  ON public.turo_bridge_reservations FROM authenticated;
GRANT SELECT ON public.turo_bridge_reservations TO authenticated;

-- turo_bridge_customers holds guest PII and is deliberately NOT added to the
-- supabase_realtime publication. Neither is turo_sync_job_pages.
--
-- turo_bridge_reservations is likewise left unpublished HERE: it is not
-- currently a member (pg_publication_tables returned no row), and
-- apps/portal/src/hooks/use-turo-bridge.ts:110-124 already polls on a 10s
-- interval plus window focus precisely because of that. Publishing it is a
-- separate, deliberate decision — uncomment if you want it, RLS is on and the
-- tenant-scoped SELECT policy makes postgres_changes enforce per subscriber:
--
--   DO $realtime$ BEGIN
--     ALTER PUBLICATION supabase_realtime ADD TABLE public.turo_bridge_reservations;
--   EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $realtime$;

COMMIT;

-- ===========================================================================
-- AFTERWARDS — three deliberate follow-ups, each a separate human decision
-- ===========================================================================
--
-- (1) Apply turo-bridge-poc/sql/01-schema.sql. It is NOT applied: production
--     turo_bridge_tokens still has a plaintext `token` column and no
--     `token_hash`, so supabase/functions/turo-bridge-ingest/index.ts:159-163
--     currently queries a column that does not exist. Ingest is broken against
--     production RIGHT NOW, independently of anything in this file.
--
-- (2) Validate the two NOT VALID constraints once the single legacy row has been
--     inspected:
--       ALTER TABLE public.turo_bridge_reservations
--         VALIDATE CONSTRAINT turo_bridge_reservations_reservation_id_nonblank;
--       ALTER TABLE public.turo_bridge_reservations
--         VALIDATE CONSTRAINT turo_bridge_reservations_dates_ordered;
--
-- (3) Schedule the reaper. Scheduling in this project is pg_cron ONLY, and the
--     repo's migrations are an inaccurate map of what is actually scheduled —
--     verify against the live cron.job table before adding anything:
--       SELECT cron.schedule('turo-reap-stale-sync-jobs', '*/5 * * * *',
--         $cron$ SELECT public.turo_reap_stale_sync_jobs(); $cron$);
--
-- ===========================================================================
-- VERIFY (run after applying)
-- ===========================================================================
-- SELECT
--   (SELECT count(*) FROM information_schema.tables
--     WHERE table_schema='public'
--       AND table_name IN ('turo_sync_jobs','turo_sync_job_pages',
--                          'turo_vehicle_map','turo_bridge_customers'))      AS new_tables,      -- expect 4
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='turo_bridge_reservations') AS reservation_cols, -- expect 49 (15 live + 34 added)
--   (SELECT count(*) FROM pg_policies WHERE tablename LIKE 'turo%')          AS turo_policies,
--   (SELECT count(*) FROM pg_constraint
--     WHERE conname IN ('blocked_dates_turo_requires_vehicle',
--                       'blocked_dates_turo_reason_is_opaque'))              AS blocked_guards,   -- expect 2
--   (SELECT count(*) FROM pg_attribute
--     WHERE attrelid='public.turo_sync_jobs'::regclass
--       AND attgenerated='s')                                                AS generated_cols;   -- expect 3
--
-- These four MUST all fail:
--   INSERT INTO public.turo_sync_jobs (tenant_id, job_kind, completeness) VALUES (...);      -- cannot write a generated column
--   INSERT INTO public.blocked_dates (tenant_id, vehicle_id, start_date, end_date, source_type,
--                                     turo_reservation_uid)
--     VALUES (t, NULL, '2026-09-01','2026-09-03','turo', r);                                 -- NULL vehicle on a Turo row
--   UPDATE public.turo_bridge_reservations SET sync_state='cancellation_candidate' WHERE ...; -- no evidence job
--   DELETE FROM public.blocked_dates WHERE source_type='turo';                                -- no release evidence


-- ############################################################################
-- ############################################################################
-- ##                                                                        ##
-- ##  APPENDIX A — RECONCILIATION + PROMOTION                               ##
-- ##  (sections 10-17; appended by the edge-function/SQL owner)             ##
-- ##                                                                        ##
-- ##  Everything above this line is the foundation data model exactly as    ##
-- ##  the schema designer wrote it. NOTHING above is renamed, dropped or    ##
-- ##  edited. This appendix is a SECOND, separately-committed transaction   ##
-- ##  that adds the surface three edge functions need:                      ##
-- ##                                                                        ##
-- ##      supabase/functions/turo-bridge-ingest/index.ts    (batch)         ##
-- ##      supabase/functions/turo-bridge-reconcile/index.ts (new)           ##
-- ##      supabase/functions/turo-bridge-promote/index.ts   (new)           ##
-- ##                                                                        ##
-- ##  It is idempotent and safe to re-run. Apply it in the SAME sitting as  ##
-- ##  sections 0-9 above and as turo-bridge-poc/sql/01-schema.sql.          ##
-- ##                                                                        ##
-- ############################################################################
--
-- ============================================================================
-- WHY THIS IS AN APPENDIX AND NOT A SECOND FILE
--
-- Four designers settled four contracts independently, and two of them named
-- the same concept twice. Rather than pick a winner and silently drop half a
-- contract, this appendix RECONCILES THE NAMES and says exactly how, because a
-- name that resolves to nothing is worse than either name:
--
--   RUN RECORD.  The schema designer specified `turo_sync_jobs`, with
--     `completeness` / `is_authoritative` / `progress_denominator` as GENERATED
--     ALWAYS columns that no caller — service_role included — can write. The
--     reconciliation designer specified `turo_bridge_runs` carrying the same
--     evidence plus `reader_outcome`, `raw_item_count`, `parsed_count` and the
--     observed window.
--
--     RESOLUTION: ONE TABLE. turo_sync_jobs is the run record; §10 adds the
--     reconciliation designer's five missing evidence columns to it, and §11
--     creates a VIEW called `turo_bridge_runs` exposing their exact column
--     names over it. Two physical run tables would mean a run written to one
--     and not the other, and "which table is authoritative" is precisely the
--     question this feature cannot afford to have.
--
--     The generated columns win over the reconciliation designer's plain
--     booleans for one reason: their own invariant I-5 ("window honesty") is
--     only a test if a client can assert it, and is a law if Postgres computes
--     it. `observed_complete` is therefore GENERATED here too.
--
--   RESERVATION STATE.  The schema designer specified `sync_state`
--     (pending_match / staged / promoted / cancellation_candidate / conflict /
--     ignored). The reconciliation designer specified `presence_state`
--     (OBSERVED / MISSING / COMPLETED_HOLD / CLOSED / CANCELLED / SUPERSEDED /
--     RELEASED_BY_OPERATOR / QUARANTINED).
--
--     RESOLUTION: BOTH, because they are genuinely orthogonal lanes and the
--     reconciliation designer said so explicitly ("Reconciliation gets a NEW
--     third column"). They answer different questions:
--
--       status         — the IMPORT lane. 'synced'|'imported'|'failed'. The
--                        shipped wire contract that turo-bridge-ingest and
--                        apps/portal/src/hooks/use-turo-bridge.ts:47 speak.
--                        UNTOUCHED.
--       sync_state     — the PIPELINE lane. Is this row matched to one of our
--                        vehicles, staged, promoted into a real rental?
--                        Written by ingest and promote.
--       presence_state — the ABSENCE lane. Is this trip still in Turo's feed?
--                        Has it completed, been cancelled, been reissued?
--                        Written by RECONCILE, and by nothing else.
--       turo_status    — TURO'S OWN word for the trip. Never ours. §15.
--
--     The seam between the two state lanes is exactly one edge:
--     reconcile drives presence_state to CANCELLED on positive evidence, and
--     ONLY THEN asks the pipeline lane to enter `cancellation_candidate`, which
--     the §7 release gate re-proves from scratch. Nothing else crosses.
--
--   FIELD ALIASES.  Where the reconciliation designer named a column the
--     schema designer had already created under another name, §12 adds the
--     second name as a GENERATED ALWAYS mirror rather than a second writable
--     column. A mirror cannot drift; two writable columns holding the same fact
--     is how a system starts lying to itself.
--
--         reconciliation name   ->  physical column (§5 above)
--         unknown_fields        ->  unmapped
--         missing_run_count     ->  missing_streak
--         first_seen_run_id     ->  first_seen_job_id
--         last_seen_run_id      ->  last_seen_job_id
--         vehicle_id            ->  matched_vehicle_id
--         block_id              ->  blocked_date_id
--
-- ============================================================================

BEGIN;

-- ===========================================================================
-- 10. turo_sync_jobs — RUN QUALIFICATION
--
-- The reconciliation designer's run-qualification evidence, added to the run
-- record that already exists.
--
-- The load-bearing one is `parsed_count`. THE LIVENESS-PROOF RULE: a run that
-- positively parsed ZERO reservations may never move any row toward MISSING. A
-- WAF answering HTTP 200 with `{"trips":[]}`, an expired session, and a
-- wholesale field rename are three different failures that present as one
-- observation — "we parsed nothing" — and all three are resolved against
-- release. Only a demonstrably working read that shows OTHER trips can cast any
-- doubt on THIS trip.
-- ===========================================================================

ALTER TABLE public.turo_sync_jobs
  -- Mirrors the reader taxonomy in
  -- turo-bridge-poc/extension/turo-read-contract.js (OUTCOME) plus the legacy
  -- values content-turo.js already emits. Left NULLABLE: a run row is written
  -- BEFORE the first fetch returns, and inventing an outcome at that moment
  -- would be exactly the kind of silent guess this project forbids.
  ADD COLUMN IF NOT EXISTS reader_outcome text,
  -- Containers seen in the envelope, BEFORE normalisation. raw_item_count > 0
  -- with parsed_count = 0 is the field-rename signature; the two counts only
  -- mean anything side by side.
  ADD COLUMN IF NOT EXISTS raw_item_count integer,
  -- Records that normalised with enough confidence to trust. THE liveness proof.
  ADD COLUMN IF NOT EXISTS parsed_count integer NOT NULL DEFAULT 0,
  -- Bound to the Turo host account this run actually read, when the extension
  -- can name one. Distinct from turo_account_fingerprint (a sha256): this is
  -- the reconciliation designer's human-comparable ref for the one-Chrome-
  -- profile / two-tenants defence (D6).
  ADD COLUMN IF NOT EXISTS turo_account_ref text;

DO $$ BEGIN
  ALTER TABLE public.turo_sync_jobs
    ADD CONSTRAINT turo_sync_jobs_reader_outcome_check
    CHECK (reader_outcome IS NULL OR reader_outcome IN (
      'OK','NO_TRIPS_CONFIRMED','EMPTY_UNCONFIRMED','NOT_LOGGED_IN','BOT_BLOCKED',
      'RATE_LIMITED','UNREACHABLE','SHAPE_CHANGED','TRUNCATED','PAGINATION_STALLED',
      'UNPARSEABLE','NO_TRIPS','UNKNOWN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_sync_jobs
    ADD CONSTRAINT turo_sync_jobs_counts_nonneg
    CHECK (parsed_count >= 0 AND (raw_item_count IS NULL OR raw_item_count >= 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_sync_jobs
    ADD CONSTRAINT turo_sync_jobs_parsed_le_seen
    CHECK (parsed_count <= records_seen);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- observed_complete — GENERATED, therefore UNFORGEABLE.
--
-- The reconciliation designer specified this as a plain boolean with a CHECK.
-- It is generated here instead, for the same reason `is_authoritative` above
-- is: a boolean a client can set is a claim, and this system's entire safety
-- argument is that a claim is never sufficient to release a block. Postgres
-- refuses any INSERT or UPDATE that supplies a value for it, service_role
-- included.
--
-- The predicate is is_authoritative's, restated in full — Postgres forbids one
-- generated column referencing another — AND-ed with the liveness proof.
-- ---------------------------------------------------------------------------
ALTER TABLE public.turo_sync_jobs
  ADD COLUMN IF NOT EXISTS observed_complete boolean
    GENERATED ALWAYS AS (
      state = 'succeeded'
      AND saw_end_of_feed
      AND degraded_reason IS NULL
      AND http_error_count = 0
      AND parse_failure_count = 0
      AND window_start IS NOT NULL
      AND window_end IS NOT NULL
      AND parsed_count > 0            -- <<< THE LIVENESS PROOF
    ) STORED;

-- ⚠ ORDERING NOTE. public.turo_release_block() (§8b, in the FIRST transaction
-- of this file) gates on THIS column, not on is_authoritative, because
-- is_authoritative can be true for a run that parsed nothing — see the comment
-- in that function. plpgsql resolves `v_job.observed_complete` at runtime
-- against a `record` variable, so the forward reference is legal; but it does
-- mean applying only the first transaction leaves the release path raising an
-- undefined-column error. That is the safe direction (nothing is released) and
-- it is deliberate: apply this whole file, or none of it.


-- `degraded` is the reconciliation designer's inverse-of-authority flag, kept
-- under their name and likewise generated. Guilty until proven: anything that
-- is not positively authoritative IS degraded.
ALTER TABLE public.turo_sync_jobs
  ADD COLUMN IF NOT EXISTS degraded boolean
    GENERATED ALWAYS AS (
      NOT (state = 'succeeded'
           AND saw_end_of_feed
           AND degraded_reason IS NULL
           AND http_error_count = 0
           AND parse_failure_count = 0
           AND window_start IS NOT NULL
           AND window_end IS NOT NULL)
    ) STORED;

-- A run may only conclude something from absence INSIDE a window it can prove
-- it covered. window_start/window_end are the raw observations the client
-- reports; these two expose them under the reconciliation designer's names, and
-- are NULL — "this run proves coverage of nothing" — unless the run is
-- genuinely complete. A truncated read therefore learns but concludes nothing.
ALTER TABLE public.turo_sync_jobs
  ADD COLUMN IF NOT EXISTS observed_from timestamptz
    GENERATED ALWAYS AS (
      CASE WHEN state = 'succeeded' AND saw_end_of_feed AND degraded_reason IS NULL
                AND http_error_count = 0 AND parse_failure_count = 0
                AND parsed_count > 0
           THEN window_start END
    ) STORED;

ALTER TABLE public.turo_sync_jobs
  ADD COLUMN IF NOT EXISTS observed_to timestamptz
    GENERATED ALWAYS AS (
      CASE WHEN state = 'succeeded' AND saw_end_of_feed AND degraded_reason IS NULL
                AND http_error_count = 0 AND parse_failure_count = 0
                AND parsed_count > 0
           THEN window_end END
    ) STORED;

COMMENT ON COLUMN public.turo_sync_jobs.parsed_count IS
  'Reservations this run positively parsed. THE LIVENESS PROOF: observed_complete is false whenever this is 0, so a WAF 200-with-empty-body, an expired session and a wholesale field rename all fail to authorise any release.';
COMMENT ON COLUMN public.turo_sync_jobs.observed_to IS
  'NULL means "this run proves coverage of nothing". Never derived from a feed-declared total — that arrives from the same possibly-degraded surface as the records.';

CREATE INDEX IF NOT EXISTS turo_sync_jobs_qualifying_idx
  ON public.turo_sync_jobs (tenant_id, job_kind, finished_at DESC)
  WHERE observed_complete;

-- ===========================================================================
-- 11. turo_bridge_runs — the reconciliation designer's contract, as a VIEW
--
-- Read-only on purpose. Runs are created and finalised through
-- turo_sync_jobs by the edge functions; this exists so that code and queries
-- written against the reconciliation contract's column names resolve, and so
-- the portal has one obvious thing to select from.
-- ===========================================================================

CREATE OR REPLACE VIEW public.turo_bridge_runs
WITH (security_invoker = true) AS
SELECT
  j.id,
  j.tenant_id,
  j.token_id,
  j.started_at,
  j.finished_at,
  j.reader_outcome,
  j.degraded,
  j.degraded_reason,
  j.raw_item_count,
  j.parsed_count,
  j.pages_fetched      AS page_count,
  j.saw_end_of_feed    AS pagination_exhausted,
  j.observed_complete,
  j.observed_from,
  j.observed_to,
  j.turo_account_ref,
  j.created_at,
  -- carried through so a caller never has to join back for the safety facts
  j.job_kind,
  j.source,
  j.state,
  j.completeness,
  j.is_authoritative,
  j.progress_denominator,
  j.records_seen,
  j.records_ingested,
  j.feed_reported_total,
  j.observed_turo_vehicle_ids
FROM public.turo_sync_jobs j;

COMMENT ON VIEW public.turo_bridge_runs IS
  'Compatibility view over turo_sync_jobs under the reconciliation contract''s column names. There is ONE run record and it is turo_sync_jobs. security_invoker=true so the tenant-scoped RLS policy on the base table applies to the viewer, not to the view owner.';

REVOKE ALL ON public.turo_bridge_runs FROM anon, authenticated;
GRANT SELECT ON public.turo_bridge_runs TO authenticated;
GRANT SELECT ON public.turo_bridge_runs TO service_role;

-- ===========================================================================
-- 12. turo_bridge_reservations — THE PRESENCE LANE
--
-- Written by turo-bridge-reconcile and by nothing else.
-- ===========================================================================

ALTER TABLE public.turo_bridge_reservations
  ADD COLUMN IF NOT EXISTS presence_state text NOT NULL DEFAULT 'OBSERVED',
  ADD COLUMN IF NOT EXISTS presence_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS presence_reason text,
  -- WHY a row left OBSERVED. Shape:
  --   {"class":"E1"|"E2"|"E3"|"E4"|"E5", "job_id":uuid|null,
  --    "actor_app_user_id":uuid|null, "turo_status":text|null, "at":iso8601,
  --    "note":text|null}
  -- Absence is deliberately NOT a member of this vocabulary. There is no
  -- evidence class that means "we did not see it".
  ADD COLUMN IF NOT EXISTS release_evidence jsonb,
  -- How we decided which of OUR cars this trip is on, and how sure we are.
  -- Persisted so a bad mapping is auditable after the fact rather than
  -- reconstructed from memory.
  ADD COLUMN IF NOT EXISTS vehicle_match_method text,
  ADD COLUMN IF NOT EXISTS vehicle_match_confidence numeric(3,2),
  -- Turo's plate string, exactly as Turo spelled it. The extension has emitted
  -- this since content-turo.js:378 and the ingest dropped it on the floor; it
  -- is the ONLY safe join key against vehicles.reg (461/461 distinct live),
  -- so without this column the promotion ladder has no tier 1.
  ADD COLUMN IF NOT EXISTS vehicle_plate text,
  -- TURO'S OWN trip state. Never ours. `status` is the import lane and
  -- `sync_state`/`presence_state` are ours; conflating any of them is how a
  -- system ends up claiming a cancelled trip is active.
  -- apps/portal/src/hooks/use-turo-bridge.ts:63 reads raw.__turo_status, which
  -- nothing writes; ingest now writes BOTH this column and that key.
  ADD COLUMN IF NOT EXISTS turo_status text,
  ADD COLUMN IF NOT EXISTS promotion_batch_id uuid,
  -- Set by reconcile when it decides a trip is gone but the evidence is only
  -- corroborated absence (E3). It is a REVIEW ITEM, never a release.
  ADD COLUMN IF NOT EXISTS missing_review_raised_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_presence_state_check
    CHECK (presence_state IN ('OBSERVED','MISSING','COMPLETED_HOLD','CLOSED',
                              'CANCELLED','SUPERSEDED','RELEASED_BY_OPERATOR',
                              'QUARANTINED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_vehicle_match_method_check
    CHECK (vehicle_match_method IS NULL OR vehicle_match_method IN
           ('listing_map','plate_exact','reg_normalised','vin_suggested',
            'label_parsed','operator','unresolved'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_vehicle_match_confidence_range
    CHECK (vehicle_match_confidence IS NULL
           OR (vehicle_match_confidence >= 0 AND vehicle_match_confidence <= 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ⚠ THE CENTRAL PRESENCE CONSTRAINT, and the direct analogue of §5's
-- cancellation_needs_evidence. A row cannot SIT in a released presence state
-- without carrying the evidence that released it. Not "was not supposed to" —
-- cannot.
DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_release_needs_evidence
    CHECK (presence_state NOT IN ('CANCELLED','CLOSED','RELEASED_BY_OPERATOR')
           OR (release_evidence IS NOT NULL
               AND jsonb_typeof(release_evidence) = 'object'
               AND release_evidence ? 'class'
               AND release_evidence ->> 'class' IN ('E1','E2','E3','E4','E5')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_missing_needs_since
    CHECK (presence_state <> 'MISSING' OR missing_since IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_superseded_needs_successor
    CHECK (presence_state <> 'SUPERSEDED' OR superseded_by_reservation_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_promotion_batch_fkey
    FOREIGN KEY (promotion_batch_id)
    REFERENCES public.turo_promotion_batches (id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table  THEN NULL;   -- added again after §15 creates the table
END $$;

-- ---- 12b. The reconciliation contract's names, as unforgeable mirrors -----
-- A GENERATED ALWAYS mirror cannot drift from what it mirrors. Two writable
-- columns holding the same fact is how a system starts lying to itself.
ALTER TABLE public.turo_bridge_reservations
  ADD COLUMN IF NOT EXISTS unknown_fields jsonb
    GENERATED ALWAYS AS (unmapped) STORED;
ALTER TABLE public.turo_bridge_reservations
  ADD COLUMN IF NOT EXISTS missing_run_count integer
    GENERATED ALWAYS AS (missing_streak) STORED;
ALTER TABLE public.turo_bridge_reservations
  ADD COLUMN IF NOT EXISTS first_seen_run_id uuid
    GENERATED ALWAYS AS (first_seen_job_id) STORED;
ALTER TABLE public.turo_bridge_reservations
  ADD COLUMN IF NOT EXISTS last_seen_run_id uuid
    GENERATED ALWAYS AS (last_seen_job_id) STORED;
ALTER TABLE public.turo_bridge_reservations
  ADD COLUMN IF NOT EXISTS block_id uuid
    GENERATED ALWAYS AS (blocked_date_id) STORED;

COMMENT ON COLUMN public.turo_bridge_reservations.presence_state IS
  'The ABSENCE lane. Written by turo-bridge-reconcile only. Orthogonal to sync_state (the pipeline lane), to status (the import lane, shipped wire contract) and to turo_status (Turo''s own word).';
COMMENT ON COLUMN public.turo_bridge_reservations.release_evidence IS
  'Why this row left OBSERVED. E1 feed-cancelled / E2 targeted probe / E3 corroborated absence raised to a human / E4 positive re-observation / E5 operator action. There is deliberately NO class meaning "we did not see it".';
COMMENT ON COLUMN public.turo_bridge_reservations.vehicle_plate IS
  'Turo''s plate string verbatim. Normalised against vehicles.reg (globally UNIQUE, 461/461 distinct live) — the only safe vehicle join key. VIN is not: 400 non-null across 326 distinct.';

CREATE INDEX IF NOT EXISTS turo_bridge_reservations_presence_idx
  ON public.turo_bridge_reservations (tenant_id, presence_state);
CREATE INDEX IF NOT EXISTS turo_bridge_reservations_plate_idx
  ON public.turo_bridge_reservations (tenant_id, vehicle_plate)
  WHERE vehicle_plate IS NOT NULL;
CREATE INDEX IF NOT EXISTS turo_bridge_reservations_missing_idx
  ON public.turo_bridge_reservations (tenant_id, missing_since)
  WHERE presence_state = 'MISSING';

-- ===========================================================================
-- 13. THE PRESENCE STATE MACHINE — enforced, not documented
--
-- The forbidden edges from the reconciliation contract's invariant list are
-- the whole point of this trigger:
--
--   MISSING -> CLOSED        absence is not completion
--   MISSING -> CANCELLED     without E1/E2/E5 — absence is not cancellation
--   * -> CANCELLED/CLOSED    on evidence from a run the DB did not judge
--                            authoritative
--   * -> CLOSED              before the 48h post-trip extension hold expires
--
-- Everything ELSE is permissive on purpose, in exactly one direction:
-- RE-BLOCKING IS THE CHEAP DIRECTION. E4 (positive re-observation) may return
-- a row to OBSERVED from ANY state including CLOSED and CANCELLED, with no
-- ceremony at all. Closed means closed, not forgotten.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.turo_bridge_presence_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed   text[];
  v_class     text;
  v_job_id    uuid;
  v_job       record;
  -- Same OLD-in-INSERT discipline as §7: every OLD reference is nested inside
  -- IF TG_OP = 'UPDATE', because Postgres does not guarantee left-to-right
  -- short-circuit of AND/OR inside an IF condition.
  v_changed   boolean := false;
  v_old_state text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_state := OLD.presence_state;
    v_changed   := (NEW.presence_state IS DISTINCT FROM OLD.presence_state);
  ELSE
    v_old_state := NULL;
    -- An INSERT may only land in a state that needs no history behind it.
    IF NEW.presence_state NOT IN ('OBSERVED','QUARANTINED') THEN
      RAISE EXCEPTION
        'A reservation may only be created OBSERVED or QUARANTINED (got %). Every other presence state is a conclusion, and a conclusion needs a prior observation to have been drawn from.',
        NEW.presence_state
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT v_changed THEN
    RETURN NEW;
  END IF;

  v_allowed := CASE v_old_state
    WHEN 'OBSERVED'             THEN ARRAY['MISSING','COMPLETED_HOLD','CANCELLED','SUPERSEDED','QUARANTINED']
    -- ⚠ NO 'CLOSED' HERE. Absence is not completion; a MISSING row that is
    --   really finished must first be observed complete.
    WHEN 'MISSING'              THEN ARRAY['OBSERVED','CANCELLED','RELEASED_BY_OPERATOR','SUPERSEDED','QUARANTINED','COMPLETED_HOLD']
    WHEN 'COMPLETED_HOLD'       THEN ARRAY['OBSERVED','CLOSED','CANCELLED','SUPERSEDED','QUARANTINED','MISSING']
    -- E4 reopens from terminal states. Re-block is the cheap direction.
    WHEN 'CLOSED'               THEN ARRAY['OBSERVED','SUPERSEDED','QUARANTINED']
    WHEN 'CANCELLED'            THEN ARRAY['OBSERVED','SUPERSEDED','QUARANTINED']
    WHEN 'RELEASED_BY_OPERATOR' THEN ARRAY['OBSERVED','SUPERSEDED','QUARANTINED']
    WHEN 'SUPERSEDED'           THEN ARRAY['OBSERVED','QUARANTINED']
    WHEN 'QUARANTINED'          THEN ARRAY['OBSERVED','MISSING','COMPLETED_HOLD','CANCELLED','SUPERSEDED']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (NEW.presence_state = ANY (v_allowed)) THEN
    RAISE EXCEPTION
      'Illegal Turo presence transition % -> % (reservation %). %',
      v_old_state, NEW.presence_state, NEW.reservation_id,
      CASE
        WHEN v_old_state = 'MISSING' AND NEW.presence_state = 'CLOSED'
          THEN 'A trip that merely stopped appearing has not been observed to finish. Absence is not evidence.'
        ELSE 'See section 13 of 03-foundation-schema.sql for the legal transition table.'
      END
      USING ERRCODE = '23514';
  END IF;

  -- ---- entering a RELEASED state demands positive, verified evidence ------
  IF NEW.presence_state IN ('CANCELLED','CLOSED','RELEASED_BY_OPERATOR') THEN
    IF NEW.release_evidence IS NULL OR jsonb_typeof(NEW.release_evidence) <> 'object' THEN
      RAISE EXCEPTION
        'Entering % requires release_evidence. There is no evidence class meaning "we did not see it".',
        NEW.presence_state USING ERRCODE = '23514';
    END IF;

    v_class := NEW.release_evidence ->> 'class';

    -- E3 is CORROBORATED ABSENCE. It raises a review item for a human; it is
    -- never itself sufficient to move a row into a released state. Repeating an
    -- unreliable observation does not make it reliable, and a WAF returning
    -- 200-with-nothing does so every single time.
    IF v_class = 'E3' THEN
      RAISE EXCEPTION
        'E3 (corroborated absence) is a REVIEW ITEM, not a release. A human decides, and their decision is recorded as E5.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.presence_state = 'RELEASED_BY_OPERATOR' THEN
      IF v_class <> 'E5' OR (NEW.release_evidence ->> 'actor_app_user_id') IS NULL THEN
        RAISE EXCEPTION
          'RELEASED_BY_OPERATOR requires class E5 and a named actor_app_user_id. The most dangerous button in this feature does not get to be anonymous.'
          USING ERRCODE = '23514';
      END IF;
    ELSIF v_class NOT IN ('E1','E2','E5') THEN
      RAISE EXCEPTION
        'Entering % requires evidence class E1 (cancelled status seen in a read), E2 (targeted probe) or E5 (operator action); got %.',
        NEW.presence_state, coalesce(v_class, '(none)')
        USING ERRCODE = '23514';
    END IF;

    -- Machine evidence must come from a run the DATABASE judged authoritative.
    -- The client reports raw observations; authority is derived (§1, §10).
    IF v_class IN ('E1','E2') THEN
      v_job_id := nullif(NEW.release_evidence ->> 'job_id', '')::uuid;
      IF v_job_id IS NULL THEN
        RAISE EXCEPTION
          'Machine evidence (class %) must name the job_id of the read it came from.', v_class
          USING ERRCODE = '23514';
      END IF;
      SELECT * INTO v_job FROM public.turo_sync_jobs WHERE id = v_job_id;
      IF v_job.id IS NULL THEN
        RAISE EXCEPTION 'release_evidence.job_id % does not exist', v_job_id USING ERRCODE = '23514';
      END IF;
      IF v_job.tenant_id <> NEW.tenant_id THEN
        RAISE EXCEPTION 'release_evidence.job_id belongs to a different tenant' USING ERRCODE = '23514';
      END IF;
      IF NOT v_job.observed_complete THEN
        RAISE EXCEPTION
          'Job % is not a qualifying read (degraded=%, parsed_count=%, degraded_reason=%). A degraded or zero-yield read cannot testify to anything.',
          v_job.id, v_job.degraded, v_job.parsed_count, coalesce(v_job.degraded_reason, 'none')
          USING ERRCODE = '23514';
      END IF;
    END IF;

    -- ---- the 48h hold, on the presence lane too --------------------------
    -- Guests extend up to 24h AFTER a trip ends and Turo auto-accepts; the
    -- second 24h exists because MV3 runs nothing while Chrome is quit, so the
    -- read that would OBSERVE the extension may simply not happen for a day.
    IF NEW.presence_state = 'CLOSED' THEN
      IF NEW.hold_until IS NOT NULL AND now() < NEW.hold_until THEN
        RAISE EXCEPTION
          'CLOSED is refused until % — "completed" is not terminal on Turo.', NEW.hold_until
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  -- ---- returning to OBSERVED is E4, and is always available ---------------
  IF NEW.presence_state = 'OBSERVED' AND v_old_state IS DISTINCT FROM 'OBSERVED' THEN
    NEW.missing_since  := NULL;
    NEW.missing_streak := 0;
    NEW.missing_review_raised_at := NULL;
    -- The evidence that RELEASED it is now historically wrong; keep the trail
    -- on the row's reason, but stop the stale evidence satisfying the CHECK.
    NEW.release_evidence := NULL;
  END IF;

  NEW.presence_changed_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS turo_bridge_presence_guard_trg ON public.turo_bridge_reservations;
-- Fires AFTER the §7 guard (alphabetical order among BEFORE row triggers:
-- turo_bridge_presence_guard_trg < turo_bridge_reservations_guard_trg), so
-- hold_until is not yet recomputed when this runs on an UPDATE that also
-- changes ends_at. That is the SAFE ordering: this trigger tests the OLD
-- (never-shortened) hold_until, so a write that simultaneously pulls ends_at
-- earlier and closes the row cannot slip past the hold.
CREATE TRIGGER turo_bridge_presence_guard_trg
  BEFORE INSERT OR UPDATE ON public.turo_bridge_reservations
  FOR EACH ROW EXECUTE FUNCTION public.turo_bridge_presence_guard();

-- ===========================================================================
-- 14. turo_bridge_conflicts — quarantine, never resolve itself
--
-- When a Turo trip collides with something of ours, the system's job is to
-- surface it loudly, not to pick a winner. The Turo reservation ALWAYS lands
-- (it is real, and discarding it is how you re-sell a car that is physically
-- gone) but writes no block.
--
-- INVARIANT I-11, INVIOLABLE: a Turo read must never cancel, shorten or modify
-- a Drive247 rental. Note there is no `rental_action` column here and no code
-- path that writes one — the conflict row is the whole response.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.turo_bridge_conflicts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reservation_row_id uuid NOT NULL,
  -- Single-column FKs on purpose for these two: rentals and vehicles have no
  -- (id, tenant_id) composite of their own until §4/§2 above add one, and the
  -- tenant match is asserted by the writing edge function AND by the CHECK that
  -- tenant_id is the reservation's. A dangling rental is set NULL, not cascaded
  -- — the conflict is still worth reading after the rental is gone.
  rental_id          uuid REFERENCES public.rentals(id)  ON DELETE SET NULL,
  vehicle_id         uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  job_id             uuid,
  kind               text NOT NULL,
  severity           text NOT NULL,
  overlap_start      timestamptz,
  overlap_end        timestamptz,
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at        timestamptz,
  resolved_by        uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  resolution         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT turo_bridge_conflicts_kind_check CHECK (kind IN (
    'overlap_committed','overlap_soft','vehicle_unresolved','vehicle_foreign_tenant',
    'succession_ambiguous','account_mismatch','extension_after_release',
    'missing_review','promotion_refused','guard_not_installed')),
  CONSTRAINT turo_bridge_conflicts_severity_check CHECK (severity IN ('blocking','review')),
  CONSTRAINT turo_bridge_conflicts_resolved_together
    CHECK ((resolved_at IS NULL) = (resolved_by IS NULL)),
  CONSTRAINT turo_bridge_conflicts_detail_is_object
    CHECK (jsonb_typeof(detail) = 'object'),
  CONSTRAINT turo_bridge_conflicts_reservation_tenant_fkey
    FOREIGN KEY (reservation_row_id, tenant_id)
    REFERENCES public.turo_bridge_reservations (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT turo_bridge_conflicts_job_tenant_fkey
    FOREIGN KEY (job_id, tenant_id)
    REFERENCES public.turo_sync_jobs (id, tenant_id) ON DELETE SET NULL (job_id)
);

-- One OPEN conflict per (reservation, kind). Re-running a sync must not stack
-- 40 identical "needs a vehicle" rows on the same trip; it refreshes the one.
CREATE UNIQUE INDEX IF NOT EXISTS turo_bridge_conflicts_open_unique
  ON public.turo_bridge_conflicts (reservation_row_id, kind)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS turo_bridge_conflicts_tenant_open_idx
  ON public.turo_bridge_conflicts (tenant_id, severity, created_at DESC)
  WHERE resolved_at IS NULL;

DROP TRIGGER IF EXISTS turo_bridge_conflicts_set_updated_at ON public.turo_bridge_conflicts;
CREATE TRIGGER turo_bridge_conflicts_set_updated_at
  BEFORE UPDATE ON public.turo_bridge_conflicts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.turo_bridge_conflicts IS
  'A Turo trip colliding with our own data. The reservation always lands; the block does not. Nothing here ever modifies a rental — that boundary (invariant I-11) is inviolable.';

-- ===========================================================================
-- 15. PROMOTION — schema
-- ===========================================================================

-- 15a. Provenance and idempotency on rentals.
-- rentals.source has NO check constraint (verified live; values are 'portal'
-- 183 and 'booking' 27), so 'turo_import' is purely additive — AND it is THE
-- SUPPRESSION KEY that every guarded trigger in §16 tests.
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS turo_reservation_id     text,
  ADD COLUMN IF NOT EXISTS turo_promoted_at        timestamptz,
  ADD COLUMN IF NOT EXISTS turo_promotion_batch_id uuid,
  -- What TURO took. Deliberately separate from monthly_amount: Turo hands back
  -- a trip TOTAL, not a monthly rate, and there is no honest derivation. This
  -- column is a record of someone else's transaction, never a Drive247 claim.
  ADD COLUMN IF NOT EXISTS turo_total_amount       numeric(12,2),
  ADD COLUMN IF NOT EXISTS turo_vehicle_match      text;

CREATE UNIQUE INDEX IF NOT EXISTS rentals_turo_reservation_uniq
  ON public.rentals (tenant_id, turo_reservation_id)
  WHERE turo_reservation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS rentals_turo_batch_idx
  ON public.rentals (turo_promotion_batch_id)
  WHERE turo_promotion_batch_id IS NOT NULL;

COMMENT ON COLUMN public.rentals.source IS
  'Booking origin. ''portal'' | ''booking'' | ''turo_import''. ⚠ ''turo_import'' is load-bearing: four triggers on this table carry a WHEN clause that tests it (see section 16 of turo-bridge-poc/sql/03-foundation-schema.sql). Changing or clearing it on a Turo-imported row does not retro-fire them, but it will mislead anyone reading the data.';

-- 15b. Placeholder guests.
-- A REAL customer cannot be created from Turo data: the host feed gives a
-- display name and nothing contactable. This ref doubles as the trigger-
-- suppression key (§16) and the idempotency key.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS turo_guest_ref          text,
  ADD COLUMN IF NOT EXISTS turo_promotion_batch_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS customers_turo_guest_uniq
  ON public.customers (tenant_id, turo_guest_ref)
  WHERE turo_guest_ref IS NOT NULL;

COMMENT ON COLUMN public.customers.turo_guest_ref IS
  'Placeholder contact imported from a Turo trip. Name only — email and phone are NULL and sms_consent stays false. This row can never be emailed or SMSed, and nothing in the promotion path ever initiates contact with a Turo guest.';

-- 15c. The audit trail, which outlives the data it describes.
CREATE TABLE IF NOT EXISTS public.turo_promotion_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_app_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  -- sha256 of the plan the operator actually looked at and approved. Apply
  -- re-runs the plan server-side and refuses on ANY drift. Approving a stale
  -- plan is exactly how the wrong car gets blocked.
  plan_hash         text NOT NULL,
  counts            jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledgements  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  reverted_at       timestamptz,
  reverted_by       uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  revert_report     jsonb,
  CONSTRAINT turo_promotion_batches_counts_is_object CHECK (jsonb_typeof(counts) = 'object'),
  CONSTRAINT turo_promotion_batches_ack_is_object    CHECK (jsonb_typeof(acknowledgements) = 'object'),
  CONSTRAINT turo_promotion_batches_id_tenant_key    UNIQUE (id, tenant_id)
);

-- Replaying an approved plan_hash returns the ORIGINAL batch rather than
-- creating a second one. Idempotency layer 3.
CREATE UNIQUE INDEX IF NOT EXISTS turo_promotion_batches_plan_uniq
  ON public.turo_promotion_batches (tenant_id, plan_hash);

-- Now that the table exists, attach the FK §12 could not.
DO $$ BEGIN
  ALTER TABLE public.turo_bridge_reservations
    ADD CONSTRAINT turo_bridge_reservations_promotion_batch_fkey
    FOREIGN KEY (promotion_batch_id)
    REFERENCES public.turo_promotion_batches (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.rentals
    ADD CONSTRAINT rentals_turo_promotion_batch_fkey
    FOREIGN KEY (turo_promotion_batch_id)
    REFERENCES public.turo_promotion_batches (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.customers
    ADD CONSTRAINT customers_turo_promotion_batch_fkey
    FOREIGN KEY (turo_promotion_batch_id)
    REFERENCES public.turo_promotion_batches (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 15d. The tenant flag. Promotion is reachable by exactly the operators who are
-- migrating, and by nobody else. 28 tenants exist; this defaults false for all
-- of them.
--
-- ⚠ NO booking-side read may ever touch this column without an explicit
--   GRANT SELECT ... TO anon first: anon holds COLUMN-level (not table-level)
--   grants on `tenants`, so an ungranted column 403s the WHOLE query and every
--   booking site falls back to default branding. That is a real incident this
--   project has already had (customer_theme_mode). No grant is issued here
--   because nothing customer-facing reads it.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS turo_bridge_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.turo_bridge_enabled IS
  'Gates turo-bridge-promote. Deliberately NOT granted to anon: anon has column-level grants on tenants and an ungranted column 403s the entire booking-side query.';

-- ===========================================================================
-- 16. SIDE-EFFECT SUPPRESSION — the four triggers a Turo import must not fire
--
-- MECHANISM: each trigger is dropped and recreated, BY NAME, WITH THE SAME
-- FUNCTION, plus a WHEN clause. All four are AFTER INSERT ... FOR EACH ROW
-- (verified against pg_get_triggerdef live), so NEW is always available and the
-- WHEN clause is exact.
--
-- Why a WHEN clause rather than the early-exit inside the function body that
-- the promotion contract described: it is strictly less invasive. The bodies of
-- trigger_generate_rental_charges, notify_new_rental,
-- private.notify_platform_rental and create_chat_channel_for_customer are
-- untouched — they still fire identically for every real booking — and there is
-- no repo migration for any of them, so a CREATE OR REPLACE would mean
-- transcribing a production function body from a catalog dump. A WHEN clause
-- changes only the firing condition, and this whole block is one transaction so
-- no window exists in which a trigger is missing.
--
-- Why not ALTER TABLE ... DISABLE TRIGGER around the import: it is GLOBAL. It
-- takes ACCESS EXCLUSIVE and any concurrent REAL booking during the window
-- would silently skip its own receivables and its own platform notification.
--
-- DRIFT ASSERTION: each block first checks that the trigger currently in the
-- database is either the exact untouched definition we recorded on 2026-09-02
-- or the guarded definition this block installs. Anything else RAISES, loudly,
-- rather than blowing away someone's later change.
-- ===========================================================================

DO $guards$
DECLARE
  r record;
  v_cur  text;
  v_want text;
  specs  jsonb := jsonb_build_array(
    jsonb_build_object(
      'tbl',  'public.rentals',
      'name', 'rental_charges_trigger',
      'fn',   'public.trigger_generate_rental_charges()',
      'orig', 'CREATE TRIGGER rental_charges_trigger AFTER INSERT ON public.rentals FOR EACH ROW EXECUTE FUNCTION trigger_generate_rental_charges()',
      'when', '(COALESCE(new.source, ''''::text) <> ''turo_import''::text)',
      'needle', 'turo_import',
      -- MANDATORY. -> generate_rental_charges() -> rental_create_charge()
      -- -> INSERT INTO ledger_entries (type='Charge'). REAL RECEIVABLES
      -- against a guest we cannot even contact. Do NOT be reassured by a short
      -- test trip: duration_months computes to 0 under a month and the loop
      -- never runs, but a 31-day Turo trip raises a real charge.
      'mandatory', true),
    jsonb_build_object(
      'tbl',  'public.rentals',
      'name', 'trg_notify_platform_rental',
      'fn',   'private.notify_platform_rental()',
      'orig', 'CREATE TRIGGER trg_notify_platform_rental AFTER INSERT ON public.rentals FOR EACH ROW EXECUTE FUNCTION private.notify_platform_rental()',
      'when', '(COALESCE(new.source, ''''::text) <> ''turo_import''::text)',
      'needle', 'turo_import',
      -- MANDATORY. -> net.http_post -> functions/v1/platform-rental-notify,
      -- which emails a hardcoded address (platform-rental-notify/index.ts:15,
      -- sent at :164). Its only existing skip is tenants.tenant_type='test',
      -- which a real migrating operator is not. 200 trips = 200 emails.
      'mandatory', true),
    jsonb_build_object(
      'tbl',  'public.rentals',
      'name', 'on_rental_created_notify',
      'fn',   'public.notify_new_rental()',
      'orig', 'CREATE TRIGGER on_rental_created_notify AFTER INSERT ON public.rentals FOR EACH ROW EXECUTE FUNCTION notify_new_rental()',
      'when', '(COALESCE(new.source, ''''::text) <> ''turo_import''::text)',
      'needle', 'turo_import',
      -- Hygiene, not safety: INSERT INTO notifications with user_id NULL, i.e.
      -- broadcast to the whole tenant. 200 imports bury the operator's real
      -- alerts. Promote writes ONE summary notification instead.
      'mandatory', false),
    jsonb_build_object(
      'tbl',  'public.customers',
      'name', 'customers_create_chat_channel',
      'fn',   'public.create_chat_channel_for_customer()',
      'orig', 'CREATE TRIGGER customers_create_chat_channel AFTER INSERT ON public.customers FOR EACH ROW EXECUTE FUNCTION create_chat_channel_for_customer()',
      'when', '(new.turo_guest_ref IS NULL)',
      'needle', 'turo_guest_ref',
      -- Hygiene: one dead support channel per ghost guest who can never reply.
      'mandatory', false)
  );
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(specs) AS s(spec)
  LOOP
    SELECT pg_get_triggerdef(t.oid) INTO v_cur
      FROM pg_trigger t
     WHERE t.tgrelid = (r.spec ->> 'tbl')::regclass
       AND t.tgname  = (r.spec ->> 'name')
       AND NOT t.tgisinternal;

    IF v_cur IS NULL THEN
      RAISE EXCEPTION
        'Trigger % on % does not exist. This appendix was written against the live catalog of hviqoaokxvlancmftwuo on 2026-09-02 and will not invent a trigger it cannot see.',
        r.spec ->> 'name', r.spec ->> 'tbl';
    END IF;

    v_want := format('%s WHEN %s EXECUTE FUNCTION %s',
                     regexp_replace(r.spec ->> 'orig', ' EXECUTE FUNCTION .*$', ''),
                     r.spec ->> 'when',
                     r.spec ->> 'fn');

    -- Already guarded? Then this is a re-run. Leave it exactly alone.
    -- Matched on the NEEDLE rather than on the rendered WHEN clause:
    -- pg_get_triggerdef re-prints an expression in its own canonical form
    -- (extra parens, explicit ::text casts), so a byte comparison against the
    -- string we wrote would fail on the second run and drop into the drift
    -- branch below.
    IF position((r.spec ->> 'needle') IN v_cur) > 0 THEN
      CONTINUE;
    END IF;

    -- Not guarded and not the definition we recorded => somebody changed it
    -- since. Refuse rather than silently discarding their work.
    IF v_cur IS DISTINCT FROM (r.spec ->> 'orig') THEN
      RAISE EXCEPTION
        E'Trigger % on % has drifted from the definition this file was written against.\nExpected: %\nFound:    %\nRefusing to recreate it. Re-verify what changed, then update section 16.',
        r.spec ->> 'name', r.spec ->> 'tbl', r.spec ->> 'orig', v_cur;
    END IF;

    EXECUTE format('DROP TRIGGER %I ON %s', r.spec ->> 'name', r.spec ->> 'tbl');
    EXECUTE v_want;
    RAISE NOTICE 'Turo import guard installed on %.%', r.spec ->> 'tbl', r.spec ->> 'name';
  END LOOP;
END
$guards$;

-- ---------------------------------------------------------------------------
-- 16b. The runtime check turo-bridge-promote calls BEFORE it writes anything.
--
-- This exists because "we applied a migration once" is not a fact an edge
-- function is entitled to assume. If a guard is missing at the moment of
-- promotion — a restore from a pre-appendix backup, someone recreating a
-- trigger from an old dump, a branch database — promote must REFUSE and say
-- which guard is absent, not proceed and email the founder 200 times.
--
-- SECURITY DEFINER: pg_trigger is readable by all, but pinning search_path and
-- granting only to service_role keeps this off the PostgREST surface for
-- ordinary users, who have no business asking.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.turo_promotion_guards()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
  WITH want(tbl, name, needle, mandatory) AS (
    VALUES
      ('public.rentals',   'rental_charges_trigger',        'turo_import',    true),
      ('public.rentals',   'trg_notify_platform_rental',    'turo_import',    true),
      ('public.rentals',   'on_rental_created_notify',      'turo_import',    false),
      ('public.customers', 'customers_create_chat_channel', 'turo_guest_ref', false)
  ), got AS (
    SELECT w.tbl, w.name, w.mandatory,
           (t.oid IS NOT NULL) AS trigger_present,
           COALESCE(position(w.needle IN pg_get_triggerdef(t.oid)) > 0, false) AS guarded
      FROM want w
      LEFT JOIN pg_trigger t
             ON t.tgrelid = w.tbl::regclass
            AND t.tgname  = w.name
            AND NOT t.tgisinternal
  )
  SELECT jsonb_build_object(
    'checked_at',      now(),
    -- The ONE key turo-bridge-promote gates on.
    'safe_to_promote', bool_and(guarded OR NOT mandatory),
    'guards', jsonb_agg(jsonb_build_object(
        'table',     tbl,
        'trigger',   name,
        'mandatory', mandatory,
        'present',   trigger_present,
        'guarded',   guarded) ORDER BY tbl, name),
    'missing_mandatory', COALESCE(
      (SELECT jsonb_agg(name ORDER BY name) FROM got WHERE mandatory AND NOT guarded),
      '[]'::jsonb)
  ) FROM got;
$$;

REVOKE ALL ON FUNCTION public.turo_promotion_guards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.turo_promotion_guards() TO service_role;

COMMENT ON FUNCTION public.turo_promotion_guards() IS
  'Pre-flight for turo-bridge-promote. Returns safe_to_promote=false when a MANDATORY side-effect guard (real receivables into ledger_entries; one platform email per trip) is not installed. The edge function refuses the whole batch on false — it never proceeds partially.';

-- ===========================================================================
-- 17. RLS + GRANTS for the appendix tables
--
-- Same shape as §9: a tenant-scoped SELECT for authenticated, service_role FOR
-- ALL, and the table-level REVOKE BEFORE the grant — PostgREST checks the grant
-- first, and a SELECT-only policy does not constrain writes for which no policy
-- exists.
-- ===========================================================================

ALTER TABLE public.turo_bridge_conflicts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turo_promotion_batches   ENABLE ROW LEVEL SECURITY;

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['turo_bridge_conflicts', 'turo_promotion_batches']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_own_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())',
      t || '_select_own_tenant', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_role_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t || '_service_role_all', t);

    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END
$rls$;

-- turo_bridge_conflicts is NOT published to supabase_realtime, deliberately.
-- `detail` carries the narrative — guest name, both sides of an overlap — and
-- publishing a table is a data-sensitivity decision, not a UX one. The portal
-- polls, as it already does for turo_bridge_reservations
-- (apps/portal/src/hooks/use-turo-bridge.ts:110-124).

COMMIT;

-- ===========================================================================
-- APPENDIX A — VERIFY (run after applying)
-- ===========================================================================
-- SELECT
--   (SELECT count(*) FROM information_schema.tables
--     WHERE table_schema='public'
--       AND table_name IN ('turo_bridge_conflicts','turo_promotion_batches'))   AS new_tables,   -- expect 2
--   (SELECT count(*) FROM information_schema.views
--     WHERE table_schema='public' AND table_name='turo_bridge_runs')            AS runs_view,    -- expect 1
--   (SELECT count(*) FROM pg_attribute
--     WHERE attrelid='public.turo_sync_jobs'::regclass AND attgenerated='s')    AS job_generated,-- expect 8
--   ((SELECT (public.turo_promotion_guards() ->> 'safe_to_promote'))::boolean)  AS promote_safe; -- expect true
--
-- These MUST all fail:
--   INSERT INTO public.turo_sync_jobs (tenant_id, job_kind, observed_complete) VALUES (...);
--       -- cannot insert a non-DEFAULT value into a generated column
--   UPDATE public.turo_bridge_reservations SET presence_state='CLOSED'
--     WHERE presence_state='MISSING';
--       -- "A trip that merely stopped appearing has not been observed to finish."
--   UPDATE public.turo_bridge_reservations
--      SET presence_state='CANCELLED',
--          release_evidence='{"class":"E3"}'::jsonb WHERE ...;
--       -- "E3 (corroborated absence) is a REVIEW ITEM, not a release."
--   UPDATE public.turo_bridge_reservations
--      SET presence_state='CANCELLED',
--          release_evidence=jsonb_build_object('class','E1','job_id',<a degraded job>) WHERE ...;
--       -- "Job ... is not a qualifying read"
--
-- And this must SUCCEED (re-block is the cheap direction, always available):
--   UPDATE public.turo_bridge_reservations SET presence_state='OBSERVED'
--     WHERE presence_state='CANCELLED';
-- ===========================================================================
