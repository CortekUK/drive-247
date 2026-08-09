-- =====================================================================
-- GMT chained-hold — Gate 1 schema
-- Spec: docs/GMT_CHAINED_HOLD_SPEC.md §3.1–3.5
--
-- HOW TO APPLY: paste into the Supabase SQL editor, or run via the
-- Management API / MCP. Deliberately NOT placed in supabase/migrations/ —
-- this project applies schema out-of-band and the migrations folder is a
-- known-inaccurate map of live state.
--
-- SAFETY: every statement is additive and idempotent. Re-running is safe.
-- Pre-verified against prod 2026-08-09: 166 rentals, 0 negative
-- deposit_amount_override, 0 values needing more than 2 decimal places,
-- so both new CHECK constraints and the type narrowing validate cleanly.
--
-- NOT INCLUDED (deliberately):
--   * §3.6 damage_claims  — gated on open decision D3 (will GMT run a
--     damage-claims workflow at all?)
--   * the I2 constraint (held ⇒ expires_at NOT NULL) — must follow the
--     backfill in §5 step 12 or it fails on legacy rows
--   * §3.7 ledger category — changes money categorisation; needs its own
--     review alongside the capture rework
-- =====================================================================

-- ---------------------------------------------------------------------
-- §3.1  Widen the deposit_hold_status CHECK.
-- Strictly permissive: a superset of the current 7 values, so no existing
-- row can violate it. Must land before any code writes a new state.
-- ---------------------------------------------------------------------
ALTER TABLE public.rentals DROP CONSTRAINT IF EXISTS rentals_deposit_hold_status_check;
ALTER TABLE public.rentals ADD CONSTRAINT rentals_deposit_hold_status_check
  CHECK (deposit_hold_status IS NULL OR deposit_hold_status = ANY (ARRAY[
    'processing','refreshing','capturing',
    'held','requires_action','failed','needs_review','disputed',
    'captured','released','expired'
  ]::text[]));

-- ---------------------------------------------------------------------
-- §3.2  rentals — anchoring, diagnostics, disclosure
-- public.rentals has NO anon grant, so none of these need GRANT SELECT.
-- (Contrast public.tenants, which has column-level anon grants — a new
-- column read by the booking app there would 403 the whole query.)
-- ---------------------------------------------------------------------

-- I3: anchor Stripe context to the RECORD. Operations on an existing hold
-- must never re-derive account/mode/currency from the tenant's CURRENT row —
-- that is what breaks holds mid-flight during the UK→UAE migration.
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS deposit_hold_connect_account_id text,
  ADD COLUMN IF NOT EXISTS deposit_hold_stripe_mode        text,
  ADD COLUMN IF NOT EXISTS deposit_hold_currency           text;

-- State machine + retry. Today any error writes terminal 'expired' and the
-- driver query never selects it again; these make failure recoverable.
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS deposit_hold_status_changed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_hold_attempt_seq          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_hold_failure_count        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_hold_last_error           text,
  ADD COLUMN IF NOT EXISTS deposit_hold_last_error_code      text,
  ADD COLUMN IF NOT EXISTS deposit_hold_next_retry_at        timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_hold_verified_at          timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_hold_release_requested_at timestamptz;

-- Expiry provenance + the window Stripe actually granted. Nothing records
-- these today, so the DB cannot answer "did this hold get 30 days or 7?"
-- nor "is this expiry real or the +7d fallback guess?".
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS deposit_hold_expiry_source    text,
  ADD COLUMN IF NOT EXISTS deposit_hold_extended_auth    boolean,
  ADD COLUMN IF NOT EXISTS deposit_hold_window_seconds   integer,
  ADD COLUMN IF NOT EXISTS deposit_hold_chain_expires_at timestamptz;

-- Card identity — makes "which card is this on" answerable and debit
-- detectable (debit stacking is the main renter-harm risk on a chain).
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS deposit_hold_card_brand     text,
  ADD COLUMN IF NOT EXISTS deposit_hold_card_last4     text,
  ADD COLUMN IF NOT EXISTS deposit_hold_card_exp_month smallint,
  ADD COLUMN IF NOT EXISTS deposit_hold_card_exp_year  smallint,
  ADD COLUMN IF NOT EXISTS deposit_hold_card_funding   text;

-- What we WANT authorized vs what currently IS authorized.
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS deposit_hold_target_amount numeric(10,2);

-- Disclosure (Visa 5.7.2.4 requires notifying the cardholder of the
-- estimated amount AND that subsequent authorization requests may follow).
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS disclosed_hold_amount  numeric(10,2),
  ADD COLUMN IF NOT EXISTS disclosed_hold_at      timestamptz,
  ADD COLUMN IF NOT EXISTS disclosed_hold_version text,
  ADD COLUMN IF NOT EXISTS disclosed_hold_source  text;  -- checkout|agreement|notice

ALTER TABLE public.rentals DROP CONSTRAINT IF EXISTS rentals_deposit_hold_stripe_mode_check;
ALTER TABLE public.rentals ADD CONSTRAINT rentals_deposit_hold_stripe_mode_check
  CHECK (deposit_hold_stripe_mode IS NULL OR deposit_hold_stripe_mode IN ('test','live'));

ALTER TABLE public.rentals DROP CONSTRAINT IF EXISTS rentals_deposit_hold_expiry_source_check;
ALTER TABLE public.rentals ADD CONSTRAINT rentals_deposit_hold_expiry_source_check
  CHECK (deposit_hold_expiry_source IS NULL
         OR deposit_hold_expiry_source IN ('stripe_capture_before','fallback'));

-- 20260527020000 added deposit_amount_override as a bare `numeric`.
ALTER TABLE public.rentals ALTER COLUMN deposit_amount_override TYPE numeric(10,2);
ALTER TABLE public.rentals DROP CONSTRAINT IF EXISTS rentals_deposit_amount_override_check;
ALTER TABLE public.rentals ADD CONSTRAINT rentals_deposit_amount_override_check
  CHECK (deposit_amount_override IS NULL OR deposit_amount_override >= 0);

-- No deposit_hold_* index existed before this.
CREATE INDEX IF NOT EXISTS idx_rentals_hold_due
  ON public.rentals (deposit_hold_expires_at)
  WHERE deposit_hold_status IN ('held','failed','refreshing','processing','capturing','requires_action');

CREATE INDEX IF NOT EXISTS idx_rentals_hold_open
  ON public.rentals (tenant_id, deposit_hold_status)
  WHERE deposit_hold_status IS NOT NULL
    AND deposit_hold_status NOT IN ('released','captured','expired');


-- ---------------------------------------------------------------------
-- §3.3  deposit_hold_links — the authorization ledger
-- One row per link, written BEFORE the Stripe call so a crashed attempt is
-- still discoverable. A chain is currently stored in a single mutable row,
-- which is why nothing can reconstruct what happened to a dead hold.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deposit_hold_links (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id            uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  attempt_seq          integer NOT NULL,
  action               text NOT NULL,   -- place|refresh|rollover|capture|release|fail
  payment_intent_id    text,
  superseded_pi_id     text,
  platform_account     text,            -- uk|uae
  connect_account_id   text,
  stripe_mode          text,
  amount_cents         integer,
  currency             text,
  idempotency_key      text,
  estimate_inputs      jsonb,
  disclosed_amount     numeric(10,2),
  disclosure_ref       text,
  capture_before       timestamptz,
  extended_auth_status text,
  card_funding         text,
  outcome              text,            -- pending|succeeded|failed|orphaned
  error_code           text,
  error_message        text,
  actor                text,            -- cron|app_user_id|webhook|reconciler
  created_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  UNIQUE (rental_id, attempt_seq, action)
);

CREATE INDEX IF NOT EXISTS idx_dhl_rental  ON public.deposit_hold_links (rental_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dhl_pi      ON public.deposit_hold_links (payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_dhl_pending ON public.deposit_hold_links (created_at) WHERE outcome = 'pending';

ALTER TABLE public.deposit_hold_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dhl_tenant_read ON public.deposit_hold_links;
CREATE POLICY dhl_tenant_read ON public.deposit_hold_links FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
-- Writes: service_role only (edge functions bypass RLS). No anon grant.


-- ---------------------------------------------------------------------
-- §3.4  cron_runs — heartbeat, so "no alerts" can be distinguished from
-- "the job is dead". NOTE: the spec omitted RLS here; enabling it with no
-- policy keeps the table service_role-only, which is correct for
-- operational metadata and avoids a world-readable public table.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cron_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name    text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  total_due   integer,
  processed   integer,
  succeeded   integer,
  failed      integer,
  truncated   boolean DEFAULT false,
  error       text
);
CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON public.cron_runs (job_name, started_at DESC);

ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cron_runs_superadmin_read ON public.cron_runs;
CREATE POLICY cron_runs_superadmin_read ON public.cron_runs FOR SELECT
  USING (public.is_super_admin());


-- ---------------------------------------------------------------------
-- §3.5  rental_card_mandates — persisted card-on-file consent.
-- Required by Visa's Stored Credential framework before any off-session
-- re-authorization series or later damage charge.
-- NOTE: the spec enabled RLS but defined no policy, which would leave the
-- table unreadable by the portal. Tenant-scoped read added to match
-- deposit_hold_links.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rental_card_mandates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id          uuid REFERENCES public.rentals(id) ON DELETE CASCADE,
  customer_id        uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_method_id  text,
  card_brand         text,
  card_last4         text,
  mandate_version    text NOT NULL,
  mandate_text       text NOT NULL,
  disclosed_amount   numeric(10,2),
  source             text NOT NULL,   -- booking_checkout|agreement|portal_update
  signed_document_id uuid,
  accepted_at        timestamptz NOT NULL DEFAULT now(),
  invalidated_at     timestamptz,
  invalidated_reason text            -- card_brand_change|pm_replaced|platform_migrated
);
CREATE INDEX IF NOT EXISTS idx_rcm_customer ON public.rental_card_mandates (customer_id, accepted_at DESC);

ALTER TABLE public.rental_card_mandates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rcm_tenant_read ON public.rental_card_mandates;
CREATE POLICY rcm_tenant_read ON public.rental_card_mandates FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());


-- ---------------------------------------------------------------------
-- Verification — run after applying.
-- ---------------------------------------------------------------------
-- select column_name from information_schema.columns
--  where table_name = 'rentals' and column_name like 'deposit_hold%' order by 1;
-- select tablename, rowsecurity from pg_tables
--  where tablename in ('deposit_hold_links','cron_runs','rental_card_mandates');
