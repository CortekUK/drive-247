-- ============================================================================
-- Payment plans (Plan B, slice 1) — schema, state machine, RLS, pp_* functions
-- docs/PAYMENT_PLANS_DESIGN.md §4 (schema), §5 (functions), §6 (state machine)
-- Code contract: supabase/functions/_shared/payment-plans/types.ts
--
-- NOT APPLIED. A file only. Applying it is a separate, explicit approval.
-- Depends on 20260925120000_ledger_allocation_prerequisites.sql
-- (payments_booking_source_check must allow 'payment_plan').
--
-- SHAPE
-- -----
-- payment_plans + payment_plan_occurrences own WHEN and HOW MUCH. Taking money
-- is the existing engine's job: pp_record_success inserts an ordinary payments
-- row with status 'Completed', and the live trigger auto_fifo_on_payment_insert
-- → payment_apply_fifo_v2 allocates it to the rental's ledger charges.
--
-- WRITES
-- ------
-- Every write goes through a SECURITY DEFINER pp_* function, executable by
-- service_role only (REVOKEd from PUBLIC, anon, authenticated at the bottom of
-- this file — Supabase's default privileges would otherwise grant EXECUTE on
-- every new function to anon and authenticated). Staff can SELECT their own
-- tenant's rows; nobody but service_role can INSERT/UPDATE/DELETE.
-- Every function that changes state checks its row count and RAISEs on zero:
-- a silent no-op is the bug class behind most of the July 2026 money bugs.
--
-- UNITS
-- -----
-- Columns hold money as numeric(12,2) (dollars, like the ledger). Every pp_*
-- PARAMETER and every jsonb key that carries money is INTEGER CENTS and says so
-- in its name (p_amount_cents, amountCents, totalCents …). A caller that passes
-- the design's shorthand `p_amount` gets "function does not exist" instead of a
-- silent 100× error.
--
-- JSON SHAPES (so the Supabase store and the PGlite store map nothing by hand)
-- -----------
-- pp_create_plan.p_plan       = types.ts Omit<PlanRow,'id'|'version'|'status'>
--                               verbatim (camelCase), plus optional
--                               anchorSource, createdVia, legacySource, legacyId.
-- pp_create_plan.p_occurrences, pp_replace_future.p_occurrences
--                             = types.ts OccurrenceDraft[] verbatim. An optional
--                               `dueAt` is CHECKED against Postgres' own
--                               (dueDate + chargeLocalTime) AT TIME ZONE timezone.
-- pp_replace_future.p_plan_patch = Partial<PlanRow> minus identity/version/status.
-- pp_claim → types.ts ClaimResult verbatim.
-- pp_get_plan → types.ts PlanRow verbatim.
-- Unknown keys RAISE (a typo must not become a silently ignored setting).
--
-- rule.end is stored as end_kind + (occurrence_count | until_date):
--   count      → occurrence_count
--   until      → until_date = `until`       (dates on or before)
--   rental_end → until_date = `rentalEnd`   (the return date at creation; dates strictly before)
--   open       → until_date = `through`     (materialised horizon)
--
-- DEVIATIONS FROM THE DESIGN TEXT, each forced by a §10.1 scenario
-- ---------------------------------------------------------------
-- * Only an auto_charge claim moves the occurrence to 'processing'. A
--   checkout_link or manual claim leaves the occurrence status alone; the
--   attempt row (claimed/in_flight) holds the occurrence through the partial
--   unique index. S3 ("occ1 requires_action; attempt 2 checkout_link
--   in_flight"), S4 and S18 ("occ1 failed … fallback link sent") require it.
-- * A manual claim may take a 'scheduled' occurrence (a payment received before
--   its due date). S10 ("10-01 operator records 5000 on occ1" — due 10-02).
-- * pp_collect_due also returns partially_paid occurrences whose due_at has
--   passed, and returns 'due' rows only once due_at ≤ as_of (an occurrence
--   moved later while 'due' must wait for its new date). S10: "10-02 charge
--   amount 15000".
-- * D12 is enforced HERE, not only by the engine's attempt_no rule: pp_claim
--   refuses an auto_charge on any occurrence carrying a refunded payment
--   (refund_amount > 0, or status Refunded / Partial Refund / Reversed). The
--   attempt_no rule alone cannot tell a manual pre-payment (S10, must be
--   charged the rest) from a partial refund (D12, must never be charged).
--
-- REFUNDS
-- -------
-- An AFTER UPDATE trigger on payments (pp_payment_settles_occurrence) re-settles
-- the linked occurrence whenever refund_amount or status changes, so a refund
-- written by the webhook, process-refund or the portal re-opens it (D12)
-- without any of them knowing about plans.
--
-- CLOCK
-- -----
-- pp_clock() is now(). Every timestamp these functions write goes through it,
-- so the PGlite evidence suite can drive a simulated calendar by replacing ONE
-- function in its own database. No production code path takes a time
-- parameter other than the p_as_of the design gives pp_collect_due,
-- pp_list_for_reminders and pp_stale_attempts.
-- ============================================================================


-- ─── Clock and date helpers ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pp_clock()
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path = public
AS $$ SELECT now() $$;

-- The occurrence's local calendar date is the truth (D3); due_at is derived.
CREATE OR REPLACE FUNCTION public.pp_due_at(p_date date, p_local_time time, p_timezone text)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path = public
AS $$ SELECT (p_date + p_local_time) AT TIME ZONE p_timezone $$;


-- ─── Tables ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_plans (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES public.tenants(id)   ON DELETE CASCADE,
  rental_id                 uuid NOT NULL REFERENCES public.rentals(id)   ON DELETE CASCADE,
  customer_id               uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  status                    text NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','paused','completed','cancelled')),
  -- WHEN (types.ts ScheduleRule)
  freq                      text NOT NULL CHECK (freq IN ('daily','weekly','monthly','dates')),
  interval_count            integer NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 52),
  by_weekday                smallint[],
  by_month_day              smallint,
  explicit_dates            date[],
  anchor_date               date NOT NULL,
  anchor_source             text NOT NULL DEFAULT 'custom' CHECK (anchor_source IN ('rental_start','custom')),
  first_occurrence          text NOT NULL DEFAULT 'on_anchor' CHECK (first_occurrence IN ('on_anchor','on_rhythm')),
  end_kind                  text NOT NULL CHECK (end_kind IN ('rental_end','count','until','open')),
  occurrence_count          integer CHECK (occurrence_count BETWEEN 1 AND 520),
  until_date                date,
  timezone                  text NOT NULL,
  charge_local_time         time NOT NULL DEFAULT '10:00' CHECK (charge_local_time >= '04:00'),
  -- HOW MUCH (types.ts AmountSpec)
  amount_mode               text NOT NULL CHECK (amount_mode IN ('split_total','split_by_days','fixed','per_period')),
  total_amount              numeric(12,2) CHECK (total_amount > 0),
  fixed_amount              numeric(12,2) CHECK (fixed_amount > 0),
  daily_rate                numeric(12,2) CHECK (daily_rate > 0),
  currency                  text NOT NULL DEFAULT 'usd' CHECK (currency ~ '^[a-z]{3}$'),
  -- HOW
  collection_method         text NOT NULL CHECK (collection_method IN ('auto_charge','checkout_link','manual')),
  fallback_to_link          boolean NOT NULL DEFAULT true,
  max_attempts              integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  retry_after_days          integer NOT NULL DEFAULT 2 CHECK (retry_after_days BETWEEN 1 AND 14),
  reminder_offsets          integer[] NOT NULL DEFAULT '{-2,0,2}',
  payment_provider          text NOT NULL DEFAULT 'stripe' CHECK (payment_provider IN ('stripe','square')),
  stripe_payment_method_id  text,
  extends_rental            boolean NOT NULL DEFAULT false,
  version                   integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by                uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_via               text NOT NULL DEFAULT 'portal' CHECK (created_via IN ('portal','booking','migration','simulation')),
  legacy_source             text CHECK (legacy_source IN ('installment_plan','payg','auto_extend')),
  legacy_id                 uuid,
  created_at                timestamptz NOT NULL DEFAULT public.pp_clock(),
  updated_at                timestamptz NOT NULL DEFAULT public.pp_clock(),
  paused_at                 timestamptz,
  cancelled_at              timestamptz,
  completed_at              timestamptz,

  -- Each freq / end kind / amount mode carries the column it needs.
  CONSTRAINT payment_plans_weekly_needs_weekday
    CHECK (freq <> 'weekly' OR (by_weekday IS NOT NULL AND cardinality(by_weekday) BETWEEN 1 AND 7)),
  CONSTRAINT payment_plans_weekday_range
    CHECK (by_weekday IS NULL OR by_weekday <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  CONSTRAINT payment_plans_monthly_needs_day
    CHECK (freq <> 'monthly' OR by_month_day IS NOT NULL),
  CONSTRAINT payment_plans_month_day_range
    CHECK (by_month_day IS NULL OR by_month_day = -1 OR by_month_day BETWEEN 1 AND 31),
  CONSTRAINT payment_plans_dates_needs_dates
    CHECK (freq <> 'dates' OR (explicit_dates IS NOT NULL AND cardinality(explicit_dates) >= 1)),
  CONSTRAINT payment_plans_count_needs_count
    CHECK (end_kind <> 'count' OR occurrence_count IS NOT NULL),
  CONSTRAINT payment_plans_end_needs_date
    CHECK (end_kind = 'count' OR until_date IS NOT NULL),
  CONSTRAINT payment_plans_split_needs_total
    CHECK (amount_mode NOT IN ('split_total','split_by_days') OR total_amount IS NOT NULL),
  CONSTRAINT payment_plans_fixed_needs_amount
    CHECK (amount_mode <> 'fixed' OR fixed_amount IS NOT NULL),
  CONSTRAINT payment_plans_per_period_needs_rate
    CHECK (amount_mode <> 'per_period' OR daily_rate IS NOT NULL),
  CONSTRAINT payment_plans_reminder_offsets_range
    CHECK (cardinality(reminder_offsets) <= 10 AND -30 <= ALL (reminder_offsets) AND 30 >= ALL (reminder_offsets)),
  CONSTRAINT payment_plans_status_stamps
    CHECK ((status <> 'paused'    OR paused_at    IS NOT NULL)
       AND (status <> 'cancelled' OR cancelled_at IS NOT NULL)
       AND (status <> 'completed' OR completed_at IS NOT NULL))
);

-- One live plan per rental.
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_plans_one_live_per_rental
  ON public.payment_plans (rental_id) WHERE status IN ('active','paused');
CREATE INDEX IF NOT EXISTS ix_payment_plans_tenant ON public.payment_plans (tenant_id);
CREATE INDEX IF NOT EXISTS ix_payment_plans_rental ON public.payment_plans (rental_id);


CREATE TABLE IF NOT EXISTS public.payment_plan_occurrences (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id            uuid NOT NULL REFERENCES public.payment_plans(id) ON DELETE CASCADE,
  rental_id          uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  seq                integer NOT NULL CHECK (seq >= 1),
  plan_version       integer NOT NULL DEFAULT 1 CHECK (plan_version >= 1),
  due_date           date NOT NULL,
  due_at             timestamptz NOT NULL,
  period_start       date,
  period_end         date,
  amount             numeric(12,2) NOT NULL CHECK (amount > 0),
  amount_paid        numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  collection_method  text NOT NULL CHECK (collection_method IN ('auto_charge','checkout_link','manual')),
  status             text NOT NULL DEFAULT 'scheduled'
                       CHECK (status IN ('scheduled','due','processing','requires_action','paid','partially_paid',
                                         'failed','skipped','waived','superseded','cancelled')),
  attempt_no         integer NOT NULL DEFAULT 0 CHECK (attempt_no >= 0),
  next_attempt_at    timestamptz,
  link_token_hash    text UNIQUE,
  moved_from         date,
  note               text,
  paid_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT public.pp_clock(),
  updated_at         timestamptz NOT NULL DEFAULT public.pp_clock(),
  CONSTRAINT payment_plan_occurrences_plan_seq_key UNIQUE (plan_id, seq),
  CONSTRAINT payment_plan_occurrences_period_order
    CHECK (period_start IS NULL OR period_end IS NULL OR period_end > period_start),
  CONSTRAINT payment_plan_occurrences_retry_only_when_failed
    CHECK (next_attempt_at IS NULL OR status = 'failed')
);

CREATE INDEX IF NOT EXISTS ix_payment_plan_occurrences_status_due
  ON public.payment_plan_occurrences (status, due_at);
CREATE INDEX IF NOT EXISTS ix_payment_plan_occurrences_rental
  ON public.payment_plan_occurrences (rental_id);
CREATE INDEX IF NOT EXISTS ix_payment_plan_occurrences_tenant
  ON public.payment_plan_occurrences (tenant_id);


CREATE TABLE IF NOT EXISTS public.payment_plan_attempts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  occurrence_id        uuid NOT NULL REFERENCES public.payment_plan_occurrences(id) ON DELETE CASCADE,
  attempt_no           integer NOT NULL CHECK (attempt_no >= 1),
  method               text NOT NULL CHECK (method IN ('auto_charge','checkout_link','manual')),
  idempotency_key      text NOT NULL,
  status               text NOT NULL DEFAULT 'claimed'
                         CHECK (status IN ('claimed','in_flight','succeeded','failed','requires_action',
                                           'indeterminate','abandoned')),
  provider             text NOT NULL CHECK (provider IN ('stripe','square','manual','simulated')),
  provider_account     text,
  provider_mode        text CHECK (provider_mode IN ('test','live')),
  provider_ref         text,
  checkout_session_id  text,
  payment_id           uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  amount               numeric(12,2) NOT NULL CHECK (amount > 0),
  decline_code         text,
  error_code           text,
  error_message        text,
  created_by           uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT public.pp_clock(),
  updated_at           timestamptz NOT NULL DEFAULT public.pp_clock(),
  finished_at          timestamptz,
  CONSTRAINT payment_plan_attempts_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT payment_plan_attempts_occurrence_attempt_no_key UNIQUE (occurrence_id, attempt_no),
  CONSTRAINT payment_plan_attempts_key_format
    CHECK (idempotency_key = 'pp:' || COALESCE(NULLIF(provider_account, ''), 'platform') || ':'
                             || occurrence_id::text || ':' || attempt_no::text)
);

-- A second concurrent charge on one occurrence is a constraint violation, not a code path.
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_plan_attempts_one_in_flight
  ON public.payment_plan_attempts (occurrence_id) WHERE status IN ('claimed','in_flight');
CREATE INDEX IF NOT EXISTS ix_payment_plan_attempts_status_created
  ON public.payment_plan_attempts (status, created_at);
CREATE INDEX IF NOT EXISTS ix_payment_plan_attempts_payment
  ON public.payment_plan_attempts (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_payment_plan_attempts_tenant
  ON public.payment_plan_attempts (tenant_id);


CREATE TABLE IF NOT EXISTS public.payment_plan_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id          uuid NOT NULL REFERENCES public.payment_plans(id) ON DELETE CASCADE,
  occurrence_id    uuid REFERENCES public.payment_plan_occurrences(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN (
                     'plan_created','plan_changed','plan_paused','plan_resumed','plan_cancelled',
                     'plan_completed','occurrence_due','reminder','link_sent','charge_attempted',
                     'charge_succeeded','charge_failed','requires_action','fallback_to_link',
                     'manual_recorded','occurrence_moved','occurrence_skipped','occurrence_waived',
                     'occurrence_paid','covered_by_balance')),
  dedupe_key       text,
  channel          text CHECK (channel IN ('email','sms','none')),
  delivery_status  text CHECK (delivery_status IN ('pending','sent','failed','skipped')),
  amount           numeric(12,2),
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id         uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT public.pp_clock(),
  CONSTRAINT payment_plan_events_dedupe_key_key UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS ix_payment_plan_events_plan_created
  ON public.payment_plan_events (plan_id, created_at);
CREATE INDEX IF NOT EXISTS ix_payment_plan_events_tenant
  ON public.payment_plan_events (tenant_id);


CREATE TABLE IF NOT EXISTS public.payment_plan_revisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id     uuid NOT NULL REFERENCES public.payment_plans(id) ON DELETE CASCADE,
  version     integer NOT NULL CHECK (version >= 2),
  changed_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  reason      text NOT NULL CHECK (length(btrim(reason)) > 0),
  before      jsonb NOT NULL,
  after       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT public.pp_clock(),
  CONSTRAINT payment_plan_revisions_plan_version_key UNIQUE (plan_id, version)
);

CREATE INDEX IF NOT EXISTS ix_payment_plan_revisions_tenant
  ON public.payment_plan_revisions (tenant_id);


ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_plan_occurrence_id uuid
    REFERENCES public.payment_plan_occurrences(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payments_payment_plan_occurrence
  ON public.payments (payment_plan_occurrence_id) WHERE payment_plan_occurrence_id IS NOT NULL;


-- ─── State machines (§6), enforced by triggers ─────────────────────────────

CREATE OR REPLACE FUNCTION public.pp_occurrence_transition_allowed(p_from text, p_to text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $$
  SELECT p_from = p_to OR CASE p_from
    WHEN 'scheduled'       THEN p_to IN ('due','paid','partially_paid','skipped','superseded','cancelled')
    WHEN 'due'             THEN p_to IN ('processing','paid','partially_paid','requires_action','failed','skipped','superseded','cancelled')
    WHEN 'processing'      THEN p_to IN ('paid','partially_paid','failed','requires_action','due')
    WHEN 'requires_action' THEN p_to IN ('processing','paid','partially_paid','failed','due','skipped','superseded','cancelled')
    WHEN 'partially_paid'  THEN p_to IN ('processing','paid','failed','requires_action','due','skipped','superseded','cancelled')
    WHEN 'failed'          THEN p_to IN ('processing','due','paid','partially_paid','requires_action','skipped','superseded','cancelled')
    WHEN 'paid'            THEN p_to IN ('partially_paid','due')   -- refunds only
    WHEN 'skipped'         THEN p_to IN ('due')                    -- operator undo
    ELSE false                                                     -- superseded, cancelled, waived: terminal
  END
$$;

CREATE OR REPLACE FUNCTION public.pp_trg_occurrence_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'scheduled' THEN
      RAISE EXCEPTION 'payment_plan_occurrences: a new occurrence must start ''scheduled'' (got %)', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.seq IS DISTINCT FROM OLD.seq
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.rental_id IS DISTINCT FROM OLD.rental_id THEN
    RAISE EXCEPTION 'payment_plan_occurrences: plan_id, seq, tenant_id and rental_id are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT public.pp_occurrence_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'payment_plan_occurrences: illegal transition % -> % (occurrence %)', OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- A retry time only means something on a failed occurrence.
  IF NEW.status <> 'failed' THEN
    NEW.next_attempt_at := NULL;
  END IF;
  NEW.updated_at := public.pp_clock();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pp_occurrence_guard ON public.payment_plan_occurrences;
CREATE TRIGGER pp_occurrence_guard
  BEFORE INSERT OR UPDATE ON public.payment_plan_occurrences
  FOR EACH ROW EXECUTE FUNCTION public.pp_trg_occurrence_guard();


CREATE OR REPLACE FUNCTION public.pp_attempt_transition_allowed(p_from text, p_to text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $$
  SELECT p_from = p_to OR CASE p_from
    WHEN 'claimed'         THEN p_to IN ('in_flight','succeeded','failed','requires_action','indeterminate','abandoned')
    WHEN 'in_flight'       THEN p_to IN ('succeeded','failed','requires_action','indeterminate','abandoned')
    WHEN 'indeterminate'   THEN p_to IN ('succeeded','failed','requires_action','abandoned')
    WHEN 'requires_action' THEN p_to IN ('succeeded','failed','abandoned')
    -- Money that arrives late (a link paid after it was abandoned, a charge the
    -- provider reports after a failure) is real and must be recordable.
    WHEN 'abandoned'       THEN p_to IN ('succeeded')
    WHEN 'failed'          THEN p_to IN ('succeeded')
    ELSE false                                            -- succeeded: terminal
  END
$$;

CREATE OR REPLACE FUNCTION public.pp_trg_attempt_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $$
BEGIN
  IF NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id OR NEW.attempt_no IS DISTINCT FROM OLD.attempt_no
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.provider_account IS DISTINCT FROM OLD.provider_account
     OR NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'payment_plan_attempts: occurrence_id, attempt_no, idempotency_key, method, tenant_id, provider_account and amount are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.pp_attempt_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'payment_plan_attempts: illegal transition % -> % (attempt %)', OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := public.pp_clock();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pp_attempt_guard ON public.payment_plan_attempts;
CREATE TRIGGER pp_attempt_guard
  BEFORE UPDATE ON public.payment_plan_attempts
  FOR EACH ROW EXECUTE FUNCTION public.pp_trg_attempt_guard();


-- ─── RLS: staff read their tenant; nobody but service_role writes ─────────

ALTER TABLE public.payment_plans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_plan_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_plan_attempts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_plan_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_plan_revisions   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_plans_staff_select ON public.payment_plans;
CREATE POLICY payment_plans_staff_select ON public.payment_plans
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_user_tenant_id()) OR (SELECT public.is_super_admin()));

DROP POLICY IF EXISTS payment_plan_occurrences_staff_select ON public.payment_plan_occurrences;
CREATE POLICY payment_plan_occurrences_staff_select ON public.payment_plan_occurrences
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_user_tenant_id()) OR (SELECT public.is_super_admin()));

DROP POLICY IF EXISTS payment_plan_attempts_staff_select ON public.payment_plan_attempts;
CREATE POLICY payment_plan_attempts_staff_select ON public.payment_plan_attempts
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_user_tenant_id()) OR (SELECT public.is_super_admin()));

DROP POLICY IF EXISTS payment_plan_events_staff_select ON public.payment_plan_events;
CREATE POLICY payment_plan_events_staff_select ON public.payment_plan_events
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_user_tenant_id()) OR (SELECT public.is_super_admin()));

DROP POLICY IF EXISTS payment_plan_revisions_staff_select ON public.payment_plan_revisions;
CREATE POLICY payment_plan_revisions_staff_select ON public.payment_plan_revisions
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_user_tenant_id()) OR (SELECT public.is_super_admin()));

-- Supabase's default privileges grant ALL on new tables to anon and
-- authenticated. Take that back: staff get SELECT (filtered by the policies
-- above), anon gets nothing, service_role keeps everything.
REVOKE ALL ON public.payment_plans, public.payment_plan_occurrences, public.payment_plan_attempts,
              public.payment_plan_events, public.payment_plan_revisions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_plans, public.payment_plan_occurrences, public.payment_plan_attempts,
                public.payment_plan_events, public.payment_plan_revisions
  TO authenticated;
GRANT ALL ON public.payment_plans, public.payment_plan_occurrences, public.payment_plan_attempts,
             public.payment_plan_events, public.payment_plan_revisions
  TO service_role;


-- ─── Internal helpers ──────────────────────────────────────────────────────

-- Insert one event. Returns true when it was written (false = dedupe hit).
CREATE OR REPLACE FUNCTION public.pp__event(
  p_plan_id uuid, p_occurrence_id uuid, p_kind text, p_dedupe_key text,
  p_amount_cents bigint, p_detail jsonb, p_actor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_rows integer;
BEGIN
  SELECT tenant_id INTO v_tenant FROM payment_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp__event: plan % not found', p_plan_id USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO payment_plan_events (tenant_id, plan_id, occurrence_id, kind, dedupe_key, amount, detail, actor_id, created_at)
  VALUES (v_tenant, p_plan_id, p_occurrence_id, p_kind, p_dedupe_key,
          CASE WHEN p_amount_cents IS NULL THEN NULL ELSE p_amount_cents / 100.0 END,
          COALESCE(p_detail, '{}'::jsonb), p_actor, pp_clock())
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

-- Complete the plan when every occurrence is settled one way or another.
CREATE OR REPLACE FUNCTION public.pp__maybe_complete_plan(p_plan_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_version integer;
BEGIN
  UPDATE payment_plans
     SET status = 'completed', completed_at = pp_clock(), updated_at = pp_clock()
   WHERE id = p_plan_id
     AND status IN ('active','paused')
     AND NOT EXISTS (
       SELECT 1 FROM payment_plan_occurrences o
        WHERE o.plan_id = p_plan_id
          AND o.status NOT IN ('paid','skipped','superseded','cancelled','waived'))
  RETURNING version INTO v_version;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM pp__event(p_plan_id, NULL, 'plan_completed', 'plan_completed:' || p_plan_id || ':' || v_version, NULL, '{}'::jsonb, NULL);
  RETURN true;
END;
$$;

-- jsonb (types.ts PlanRow minus id/version/status) → a payment_plans record.
CREATE OR REPLACE FUNCTION public.pp__plan_from_json(p jsonb)
 RETURNS public.payment_plans
 LANGUAGE plpgsql
 STABLE
 SET search_path = public
AS $$
DECLARE
  r      public.payment_plans;
  v_rule jsonb;
  v_end  jsonb;
  v_amt  jsonb;
  k      text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'payment plan: expected a JSON object' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p) LOOP
    IF k NOT IN ('tenantId','rentalId','customerId','rule','amount','currency','timezone','chargeLocalTime',
                 'collectionMethod','fallbackToLink','maxAttempts','retryAfterDays','reminderOffsets',
                 'paymentProvider','stripePaymentMethodId','extendsRental',
                 'anchorSource','createdVia','legacySource','legacyId') THEN
      RAISE EXCEPTION 'payment plan: unknown field "%"', k USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_rule := p->'rule';
  v_end  := v_rule->'end';
  v_amt  := p->'amount';
  IF v_rule IS NULL OR jsonb_typeof(v_rule) <> 'object' THEN
    RAISE EXCEPTION 'payment plan: rule is required' USING ERRCODE = '22023';
  END IF;
  IF v_end IS NULL OR jsonb_typeof(v_end) <> 'object' THEN
    RAISE EXCEPTION 'payment plan: rule.end is required' USING ERRCODE = '22023';
  END IF;
  IF v_amt IS NULL OR jsonb_typeof(v_amt) <> 'object' THEN
    RAISE EXCEPTION 'payment plan: amount is required' USING ERRCODE = '22023';
  END IF;

  r.tenant_id        := (p->>'tenantId')::uuid;
  r.rental_id        := (p->>'rentalId')::uuid;
  r.customer_id      := (p->>'customerId')::uuid;
  r.freq             := v_rule->>'freq';
  r.interval_count   := COALESCE((v_rule->>'interval')::integer, 1);
  r.by_weekday       := CASE WHEN jsonb_typeof(v_rule->'byWeekday') = 'array'
                             THEN ARRAY(SELECT x::smallint FROM jsonb_array_elements_text(v_rule->'byWeekday') x) END;
  r.by_month_day     := (v_rule->>'byMonthDay')::smallint;
  r.explicit_dates   := CASE WHEN jsonb_typeof(v_rule->'dates') = 'array'
                             THEN ARRAY(SELECT x::date FROM jsonb_array_elements_text(v_rule->'dates') x) END;
  r.anchor_date      := (v_rule->>'anchor')::date;
  r.first_occurrence := COALESCE(v_rule->>'firstOccurrence', 'on_anchor');
  r.end_kind         := v_end->>'kind';
  r.occurrence_count := CASE WHEN r.end_kind = 'count' THEN (v_end->>'count')::integer END;
  r.until_date       := CASE r.end_kind
                          WHEN 'until'      THEN (v_end->>'until')::date
                          WHEN 'rental_end' THEN (v_end->>'rentalEnd')::date
                          WHEN 'open'       THEN (v_end->>'through')::date
                        END;
  r.amount_mode      := v_amt->>'mode';
  -- ::bigint refuses fractional cents ('100.5' is an error, not a rounding).
  r.total_amount     := CASE WHEN r.amount_mode IN ('split_total','split_by_days')
                             THEN (v_amt->>'totalCents')::bigint / 100.0 END;
  r.fixed_amount     := CASE WHEN r.amount_mode = 'fixed' THEN (v_amt->>'amountCents')::bigint / 100.0 END;
  r.daily_rate       := CASE WHEN r.amount_mode = 'per_period' THEN (v_amt->>'dailyRateCents')::bigint / 100.0 END;
  r.currency         := lower(COALESCE(p->>'currency', 'usd'));
  r.timezone         := p->>'timezone';
  r.charge_local_time:= COALESCE(p->>'chargeLocalTime', '10:00')::time;
  r.collection_method:= p->>'collectionMethod';
  r.fallback_to_link := COALESCE((p->>'fallbackToLink')::boolean, true);
  r.max_attempts     := COALESCE((p->>'maxAttempts')::integer, 3);
  r.retry_after_days := COALESCE((p->>'retryAfterDays')::integer, 2);
  r.reminder_offsets := CASE WHEN jsonb_typeof(p->'reminderOffsets') = 'array'
                             THEN ARRAY(SELECT x::integer FROM jsonb_array_elements_text(p->'reminderOffsets') x)
                             ELSE '{-2,0,2}'::integer[] END;
  r.payment_provider := COALESCE(p->>'paymentProvider', 'stripe');
  r.stripe_payment_method_id := p->>'stripePaymentMethodId';
  r.extends_rental   := COALESCE((p->>'extendsRental')::boolean, false);
  r.anchor_source    := p->>'anchorSource';
  r.created_via      := COALESCE(p->>'createdVia', 'portal');
  r.legacy_source    := p->>'legacySource';
  r.legacy_id        := (p->>'legacyId')::uuid;

  IF r.timezone IS NULL THEN
    RAISE EXCEPTION 'payment plan: timezone is required' USING ERRCODE = '22023';
  END IF;
  -- An unknown IANA name raises here ("time zone … not recognized").
  PERFORM now() AT TIME ZONE r.timezone;
  RETURN r;
END;
$$;

-- A payment_plans row → types.ts PlanRow (camelCase, cents).
CREATE OR REPLACE FUNCTION public.pp__plan_to_json(r public.payment_plans)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', r.id, 'tenantId', r.tenant_id, 'rentalId', r.rental_id, 'customerId', r.customer_id,
    'status', r.status,
    'rule', jsonb_strip_nulls(jsonb_build_object(
      'freq', r.freq,
      'interval', r.interval_count,
      'byWeekday', CASE WHEN r.by_weekday IS NOT NULL THEN to_jsonb(r.by_weekday) END,
      'byMonthDay', r.by_month_day,
      'dates', CASE WHEN r.explicit_dates IS NOT NULL
                    THEN (SELECT jsonb_agg(to_char(d, 'YYYY-MM-DD') ORDER BY d) FROM unnest(r.explicit_dates) d) END,
      'anchor', to_char(r.anchor_date, 'YYYY-MM-DD'),
      'firstOccurrence', r.first_occurrence,
      'end', CASE r.end_kind
               WHEN 'count'      THEN jsonb_build_object('kind', 'count', 'count', r.occurrence_count)
               WHEN 'until'      THEN jsonb_build_object('kind', 'until', 'until', to_char(r.until_date, 'YYYY-MM-DD'))
               WHEN 'rental_end' THEN jsonb_build_object('kind', 'rental_end', 'rentalEnd', to_char(r.until_date, 'YYYY-MM-DD'))
               WHEN 'open'       THEN jsonb_build_object('kind', 'open', 'through', to_char(r.until_date, 'YYYY-MM-DD'))
             END)),
    'amount', CASE r.amount_mode
                WHEN 'split_total'   THEN jsonb_build_object('mode', 'split_total',   'totalCents', round(r.total_amount * 100)::bigint)
                WHEN 'split_by_days' THEN jsonb_build_object('mode', 'split_by_days', 'totalCents', round(r.total_amount * 100)::bigint)
                WHEN 'fixed'         THEN jsonb_build_object('mode', 'fixed',         'amountCents', round(r.fixed_amount * 100)::bigint)
                WHEN 'per_period'    THEN jsonb_build_object('mode', 'per_period',    'dailyRateCents', round(r.daily_rate * 100)::bigint)
              END,
    'currency', r.currency,
    'timezone', r.timezone,
    'chargeLocalTime', to_char(r.charge_local_time, 'HH24:MI'),
    'collectionMethod', r.collection_method,
    'fallbackToLink', r.fallback_to_link,
    'maxAttempts', r.max_attempts,
    'retryAfterDays', r.retry_after_days,
    'reminderOffsets', to_jsonb(r.reminder_offsets),
    'paymentProvider', r.payment_provider,
    'stripePaymentMethodId', r.stripe_payment_method_id,
    'extendsRental', r.extends_rental,
    'version', r.version)
$$;

-- Insert occurrence drafts (types.ts OccurrenceDraft[]) for a plan. Seqs are
-- assigned after the plan's current maximum, in the drafts' own seq order.
CREATE OR REPLACE FUNCTION public.pp__insert_occurrences(p_plan public.payment_plans, p_occurrences jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_base   integer;
  v_n      integer := 0;
  d        jsonb;
  k        text;
  v_date   date;
  v_due_at timestamptz;
BEGIN
  IF p_occurrences IS NULL OR jsonb_typeof(p_occurrences) <> 'array' OR jsonb_array_length(p_occurrences) = 0 THEN
    RAISE EXCEPTION 'payment plan: at least one occurrence is required' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(max(seq), 0) INTO v_base FROM payment_plan_occurrences WHERE plan_id = p_plan.id;

  FOR d IN
    SELECT e FROM jsonb_array_elements(p_occurrences) WITH ORDINALITY AS t(e, ord)
     ORDER BY COALESCE((e->>'seq')::integer, ord::integer), ord
  LOOP
    FOR k IN SELECT jsonb_object_keys(d) LOOP
      IF k NOT IN ('seq','dueDate','periodStart','periodEnd','days','amountCents','isStub','dueAt','collectionMethod') THEN
        RAISE EXCEPTION 'occurrence draft: unknown field "%"', k USING ERRCODE = '22023';
      END IF;
    END LOOP;
    v_date := (d->>'dueDate')::date;
    IF v_date IS NULL THEN
      RAISE EXCEPTION 'occurrence draft: dueDate is required' USING ERRCODE = '22023';
    END IF;
    v_due_at := pp_due_at(v_date, p_plan.charge_local_time, p_plan.timezone);
    -- The TS layer (dates.ts dueAtUtc) and Postgres must agree on the instant.
    IF d ? 'dueAt' AND (d->>'dueAt')::timestamptz IS DISTINCT FROM v_due_at THEN
      RAISE EXCEPTION 'occurrence draft: dueAt % disagrees with Postgres (%)', d->>'dueAt', v_due_at
        USING ERRCODE = '22023';
    END IF;
    v_n := v_n + 1;
    INSERT INTO payment_plan_occurrences (
      tenant_id, plan_id, rental_id, seq, plan_version, due_date, due_at,
      period_start, period_end, amount, collection_method, status, created_at, updated_at)
    VALUES (
      p_plan.tenant_id, p_plan.id, p_plan.rental_id, v_base + v_n, p_plan.version, v_date, v_due_at,
      (d->>'periodStart')::date, (d->>'periodEnd')::date,
      (d->>'amountCents')::bigint / 100.0,
      COALESCE(d->>'collectionMethod', p_plan.collection_method),
      'scheduled', pp_clock(), pp_clock());
  END LOOP;
  RETURN v_n;
END;
$$;


-- ─── The store contract (§5) ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pp_get_plan(p_plan_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  r payment_plans;
BEGIN
  SELECT * INTO r FROM payment_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN pp__plan_to_json(r);
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_create_plan(p_plan jsonb, p_occurrences jsonb, p_actor uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  r        payment_plans;
  v_rental rentals;
  v_n      integer;
BEGIN
  r := pp__plan_from_json(p_plan);

  SELECT * INTO v_rental FROM rentals WHERE id = r.rental_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_create_plan: rental % not found', r.rental_id USING ERRCODE = 'P0002';
  END IF;
  -- The plan's tenant and customer must be the rental's own.
  IF v_rental.tenant_id IS DISTINCT FROM r.tenant_id THEN
    RAISE EXCEPTION 'pp_create_plan: rental % does not belong to tenant %', r.rental_id, r.tenant_id
      USING ERRCODE = '42501';
  END IF;
  IF v_rental.customer_id IS DISTINCT FROM r.customer_id THEN
    RAISE EXCEPTION 'pp_create_plan: rental % does not belong to customer %', r.rental_id, r.customer_id
      USING ERRCODE = '42501';
  END IF;

  r.id            := gen_random_uuid();
  r.status        := 'active';
  r.version       := 1;
  r.anchor_source := COALESCE(r.anchor_source,
                       CASE WHEN r.anchor_date = v_rental.start_date THEN 'rental_start' ELSE 'custom' END);
  r.created_by    := p_actor;
  r.created_at    := pp_clock();
  r.updated_at    := pp_clock();
  INSERT INTO payment_plans SELECT r.*;

  v_n := pp__insert_occurrences(r, p_occurrences);
  PERFORM pp__event(r.id, NULL, 'plan_created', NULL, NULL,
                    jsonb_build_object('occurrences', v_n, 'version', 1), p_actor);
  RETURN r.id;
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_replace_future(
  p_plan_id uuid, p_expected_version integer, p_plan_patch jsonb, p_occurrences jsonb,
  p_actor uuid DEFAULT NULL, p_reason text DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  c          payment_plans;
  r          payment_plans;
  v_before   jsonb;
  v_merged   jsonb;
  k          text;
  v_rows     integer;
  v_new      integer;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'pp_replace_future: a reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM payment_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_replace_future: plan % not found', p_plan_id USING ERRCODE = 'P0002';
  END IF;
  IF c.version <> p_expected_version THEN
    RAISE EXCEPTION 'pp_replace_future: version conflict on plan % (expected %, found %)',
      p_plan_id, p_expected_version, c.version USING ERRCODE = '40001';
  END IF;
  IF c.status NOT IN ('active','paused') THEN
    RAISE EXCEPTION 'pp_replace_future: plan % is %', p_plan_id, c.status USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM payment_plan_occurrences WHERE plan_id = p_plan_id AND status = 'processing') THEN
    RAISE EXCEPTION 'pp_replace_future: plan % has a charge in flight; try again when it settles', p_plan_id
      USING ERRCODE = '55000';
  END IF;

  p_plan_patch := COALESCE(p_plan_patch, '{}'::jsonb);
  FOR k IN SELECT jsonb_object_keys(p_plan_patch) LOOP
    IF k NOT IN ('rule','amount','currency','timezone','chargeLocalTime','collectionMethod','fallbackToLink',
                 'maxAttempts','retryAfterDays','reminderOffsets','paymentProvider','stripePaymentMethodId',
                 'extendsRental') THEN
      RAISE EXCEPTION 'pp_replace_future: field "%" cannot be patched', k USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_before := pp__plan_to_json(c);
  v_merged := (v_before - 'id' - 'status' - 'version') || p_plan_patch;
  r := pp__plan_from_json(v_merged);

  -- Supersede every open, unpaid occurrence. An open checkout link or manual
  -- claim on one of them is abandoned with it (a late payment on it is still
  -- recordable — see pp_attempt_transition_allowed).
  UPDATE payment_plan_attempts a
     SET status = 'abandoned', finished_at = pp_clock(), error_message = 'superseded by a plan change'
    FROM payment_plan_occurrences o
   WHERE a.occurrence_id = o.id AND o.plan_id = p_plan_id
     AND o.status IN ('scheduled','due','failed','requires_action','partially_paid')
     AND a.status IN ('claimed','in_flight');
  UPDATE payment_plan_occurrences
     SET status = 'superseded'
   WHERE plan_id = p_plan_id
     AND status IN ('scheduled','due','failed','requires_action','partially_paid');

  v_new := c.version + 1;
  UPDATE payment_plans SET
    freq = r.freq, interval_count = r.interval_count, by_weekday = r.by_weekday, by_month_day = r.by_month_day,
    explicit_dates = r.explicit_dates, anchor_date = r.anchor_date, first_occurrence = r.first_occurrence,
    end_kind = r.end_kind, occurrence_count = r.occurrence_count, until_date = r.until_date,
    timezone = r.timezone, charge_local_time = r.charge_local_time, amount_mode = r.amount_mode,
    total_amount = r.total_amount, fixed_amount = r.fixed_amount, daily_rate = r.daily_rate,
    currency = r.currency, collection_method = r.collection_method, fallback_to_link = r.fallback_to_link,
    max_attempts = r.max_attempts, retry_after_days = r.retry_after_days, reminder_offsets = r.reminder_offsets,
    payment_provider = r.payment_provider, stripe_payment_method_id = r.stripe_payment_method_id,
    extends_rental = r.extends_rental, version = v_new, updated_at = pp_clock()
  WHERE id = p_plan_id AND version = c.version;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp_replace_future: plan % was not updated', p_plan_id;
  END IF;

  SELECT * INTO r FROM payment_plans WHERE id = p_plan_id;
  PERFORM pp__insert_occurrences(r, p_occurrences);

  INSERT INTO payment_plan_revisions (tenant_id, plan_id, version, changed_by, reason, before, after, created_at)
  VALUES (c.tenant_id, p_plan_id, v_new, p_actor, p_reason, v_before, pp__plan_to_json(r), pp_clock());
  PERFORM pp__event(p_plan_id, NULL, 'plan_changed', NULL, NULL,
                    jsonb_build_object('version', v_new, 'reason', p_reason), p_actor);
  RETURN v_new;
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_collect_due(p_as_of timestamptz, p_tenant uuid DEFAULT NULL, p_plan uuid DEFAULT NULL)
 RETURNS SETOF public.payment_plan_occurrences
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
BEGIN
  IF p_as_of IS NULL THEN
    RAISE EXCEPTION 'pp_collect_due: p_as_of is required' USING ERRCODE = '22023';
  END IF;

  UPDATE payment_plan_occurrences o
     SET status = 'due'
    FROM payment_plans pl
   WHERE pl.id = o.plan_id
     AND pl.status = 'active'
     AND o.status = 'scheduled'
     AND o.due_at <= p_as_of
     AND (p_tenant IS NULL OR o.tenant_id = p_tenant)
     AND (p_plan IS NULL OR o.plan_id = p_plan);

  RETURN QUERY
  SELECT o.*
    FROM payment_plan_occurrences o
    JOIN payment_plans pl ON pl.id = o.plan_id
   WHERE pl.status = 'active'
     AND (p_tenant IS NULL OR o.tenant_id = p_tenant)
     AND (p_plan IS NULL OR o.plan_id = p_plan)
     AND (   (o.status IN ('due','partially_paid') AND o.due_at <= p_as_of)
          OR (o.status = 'failed' AND o.next_attempt_at IS NOT NULL AND o.next_attempt_at <= p_as_of))
   ORDER BY o.due_at, o.seq;
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_list_for_reminders(
  p_as_of timestamptz, p_horizon_days integer, p_tenant uuid DEFAULT NULL, p_plan uuid DEFAULT NULL)
 RETURNS SETOF public.payment_plan_occurrences
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $$
  SELECT o.*
    FROM payment_plan_occurrences o
    JOIN payment_plans pl ON pl.id = o.plan_id
   WHERE pl.status = 'active'
     AND o.status IN ('scheduled','due','failed','requires_action','partially_paid')
     AND (p_tenant IS NULL OR o.tenant_id = p_tenant)
     AND (p_plan IS NULL OR o.plan_id = p_plan)
     AND o.due_date BETWEEN (p_as_of AT TIME ZONE pl.timezone)::date - GREATEST(p_horizon_days, 0)
                        AND (p_as_of AT TIME ZONE pl.timezone)::date + GREATEST(p_horizon_days, 0)
   ORDER BY o.due_at, o.seq
$$;


CREATE OR REPLACE FUNCTION public.pp_apply_rental_credit(p_rental_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_payment uuid;
  v_n       integer := 0;
BEGIN
  FOR v_payment IN
    SELECT p.id FROM payments p
     WHERE p.rental_id = p_rental_id
       AND p.status IN ('Credit','Partial')
       AND COALESCE(p.remaining_amount, 0) > 0
       AND p.capture_status IS DISTINCT FROM 'requires_capture'
     ORDER BY p.payment_date ASC, p.id ASC
  LOOP
    PERFORM payment_apply_fifo_v2(v_payment);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_rental_owed_cents(p_rental_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $$
  SELECT GREATEST(0, round(100 * (
      COALESCE((SELECT sum(le.remaining_amount) FROM ledger_entries le
                 WHERE le.rental_id = p_rental_id
                   AND le.type = 'Charge'
                   AND le.remaining_amount > 0
                   AND le.category <> 'Security Deposit'), 0)
    - COALESCE((SELECT sum(p.remaining_amount) FROM payments p
                 WHERE p.rental_id = p_rental_id
                   AND p.status IN ('Credit','Partial')
                   AND COALESCE(p.remaining_amount, 0) > 0
                   AND p.capture_status IS DISTINCT FROM 'requires_capture'), 0)
  )))::bigint
$$;


CREATE OR REPLACE FUNCTION public.pp_claim(p_occurrence_id uuid, p_method text, p_provider_account text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  o           payment_plan_occurrences;
  pl          payment_plans;
  v_owed      bigint;
  v_remaining bigint;
  v_amount    bigint;
  v_no        integer;
  v_key       text;
  v_attempt   uuid;
  v_rows      integer;
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('auto_charge','checkout_link','manual') THEN
    RAISE EXCEPTION 'pp_claim: unknown method %', p_method USING ERRCODE = '22023';
  END IF;

  SELECT * INTO o FROM payment_plan_occurrences WHERE id = p_occurrence_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_claim: occurrence % not found', p_occurrence_id USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO pl FROM payment_plans WHERE id = o.plan_id;

  -- One holder at a time. The partial unique index is the real guarantee;
  -- this turns the race loser's violation into an answer.
  IF EXISTS (SELECT 1 FROM payment_plan_attempts
              WHERE occurrence_id = o.id AND status IN ('claimed','in_flight')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'held_elsewhere');
  END IF;

  IF NOT (o.status IN ('due','failed','requires_action','partially_paid')
          OR (o.status = 'scheduled' AND p_method = 'manual')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_claimable');
  END IF;
  -- Only an active plan is collected; an operator may still record money
  -- against a paused or completed one, never a cancelled one.
  IF pl.status = 'cancelled' OR (p_method <> 'manual' AND pl.status <> 'active') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_claimable');
  END IF;
  -- D12: a refunded occurrence is never auto-charged again.
  IF p_method = 'auto_charge' AND EXISTS (
       SELECT 1 FROM payments p
        WHERE p.payment_plan_occurrence_id = o.id
          AND (COALESCE(p.refund_amount, 0) > 0 OR p.status IN ('Refunded','Partial Refund','Reversed'))) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_claimable');
  END IF;

  -- D5: never more than the rental owes.
  PERFORM pp_apply_rental_credit(o.rental_id);
  v_owed      := pp_rental_owed_cents(o.rental_id);
  v_remaining := GREATEST(round((o.amount - o.amount_paid) * 100)::bigint, 0);
  v_amount    := LEAST(v_remaining, v_owed);

  IF v_amount <= 0 THEN
    UPDATE payment_plan_occurrences SET status = 'skipped' WHERE id = o.id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'pp_claim: occurrence % was not skipped', o.id;
    END IF;
    PERFORM pp__event(o.plan_id, o.id, 'covered_by_balance', 'covered_by_balance:' || o.id, v_remaining,
                      jsonb_build_object('remainingCents', v_remaining, 'owedCents', v_owed), NULL);
    PERFORM pp__maybe_complete_plan(o.plan_id);
    RETURN jsonb_build_object('ok', false, 'reason', 'nothing_owed');
  END IF;

  v_no  := o.attempt_no + 1;
  v_key := 'pp:' || COALESCE(NULLIF(p_provider_account, ''), 'platform') || ':' || o.id::text || ':' || v_no::text;

  INSERT INTO payment_plan_attempts (
    tenant_id, occurrence_id, attempt_no, method, idempotency_key, status, provider,
    provider_account, amount, created_at, updated_at)
  VALUES (
    o.tenant_id, o.id, v_no, p_method, v_key, 'claimed',
    CASE WHEN p_method = 'manual' THEN 'manual' ELSE pl.payment_provider END,
    NULLIF(p_provider_account, ''), v_amount / 100.0, pp_clock(), pp_clock())
  RETURNING id INTO v_attempt;

  -- Only a card charge puts the occurrence in 'processing'. A link or a manual
  -- record is held by its attempt row alone (see header: S3, S4, S10, S18).
  UPDATE payment_plan_occurrences
     SET attempt_no = v_no,
         status = CASE WHEN p_method = 'auto_charge' THEN 'processing' ELSE status END
   WHERE id = o.id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp_claim: occurrence % was not claimed', o.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'claim', jsonb_build_object(
    'attemptId', v_attempt, 'attemptNo', v_no, 'idempotencyKey', v_key, 'amountCents', v_amount));
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_mark_in_flight(p_attempt_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE payment_plan_attempts SET status = 'in_flight'
   WHERE id = p_attempt_id AND status = 'claimed';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp_mark_in_flight: attempt % is not claimed (status %)', p_attempt_id,
      (SELECT status FROM payment_plan_attempts WHERE id = p_attempt_id) USING ERRCODE = '55000';
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_settle_occurrence(p_occurrence_id uuid)
 RETURNS public.payment_plan_occurrences
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  o       payment_plan_occurrences;
  v_paid  numeric;
  v_n     integer;
  v_new   text;
BEGIN
  SELECT * INTO o FROM payment_plan_occurrences WHERE id = p_occurrence_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_settle_occurrence: occurrence % not found', p_occurrence_id USING ERRCODE = 'P0002';
  END IF;

  -- Money = captured payments net of refunds. v_n counts EVERY linked payment
  -- (a 'Reversed' chargeback included), so an occurrence whose money has gone
  -- — refunded or reversed — is re-opened rather than left 'paid' at 0.
  SELECT GREATEST(COALESCE(sum(p.amount - COALESCE(p.refund_amount, 0))
                    FILTER (WHERE p.status IN ('Applied','Credit','Partial','Completed','Partial Refund','Refunded')), 0), 0),
         count(*)
    INTO v_paid, v_n
    FROM payments p
   WHERE p.payment_plan_occurrence_id = o.id
     AND p.capture_status IS DISTINCT FROM 'requires_capture';

  v_new := o.status;
  IF o.status IN ('superseded','cancelled','waived','skipped') THEN
    v_new := o.status;                 -- history rows record the money, never move
  ELSIF v_paid >= o.amount THEN
    v_new := 'paid';
  ELSIF v_paid > 0 THEN
    v_new := 'partially_paid';
  ELSIF v_n > 0 AND o.status IN ('paid','partially_paid') THEN
    v_new := 'due';                    -- D12: refunded to zero → re-opened, attempt_no kept
  END IF;

  UPDATE payment_plan_occurrences
     SET amount_paid = v_paid,
         status      = v_new,
         paid_at     = CASE WHEN v_new = 'paid' THEN COALESCE(o.paid_at, pp_clock())
                            WHEN v_new IN ('due','partially_paid') THEN NULL
                            ELSE o.paid_at END
   WHERE id = o.id
  RETURNING * INTO o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_settle_occurrence: occurrence % was not updated', p_occurrence_id;
  END IF;

  PERFORM pp__maybe_complete_plan(o.plan_id);
  RETURN o;
END;
$$;


-- The 10-argument form of an earlier draft must not survive next to this one:
-- PostgREST cannot choose between overloads that both fit a call.
DROP FUNCTION IF EXISTS public.pp_record_success(uuid, bigint, text, text, text, text, text, date, text, text);

CREATE OR REPLACE FUNCTION public.pp_record_success(
  p_attempt_id uuid, p_amount_cents bigint, p_provider_ref text, p_provider_account text,
  p_provider_mode text, p_payment_provider text, p_platform_account text, p_payment_date date,
  p_method text, p_checkout_session_id text DEFAULT NULL,
  -- An operator's manual record keeps who and why: on the attempt
  -- (created_by) and on the event (actor_id, detail.note).
  p_note text DEFAULT NULL, p_actor uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  a          payment_plan_attempts;
  o          payment_plan_occurrences;
  pl         payment_plans;
  v_vehicle  uuid;
  v_payment  uuid;
  v_card     boolean;
  v_rows     integer;
BEGIN
  SELECT * INTO a FROM payment_plan_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_record_success: attempt % not found', p_attempt_id USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent: a second delivery of the same success returns the first payment.
  IF a.status = 'succeeded' THEN
    IF a.payment_id IS NULL THEN
      RAISE EXCEPTION 'pp_record_success: attempt % succeeded without a payment', p_attempt_id;
    END IF;
    RETURN a.payment_id;
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'pp_record_success: amount must be positive cents (got %)', p_amount_cents USING ERRCODE = '22023';
  END IF;
  -- D5 at the money boundary: a card charge records exactly what was claimed.
  -- More means the provider took more than the rental owed; the engine refunds.
  IF a.method = 'auto_charge' AND p_amount_cents <> round(a.amount * 100)::bigint THEN
    RAISE EXCEPTION 'pp_record_success: attempt % claimed % cents, provider reported %',
      p_attempt_id, round(a.amount * 100)::bigint, p_amount_cents USING ERRCODE = '22023';
  END IF;
  IF p_payment_provider IS NULL OR p_payment_provider NOT IN ('stripe','square') THEN
    RAISE EXCEPTION 'pp_record_success: payment_provider must be stripe or square (got %)', p_payment_provider
      USING ERRCODE = '22023';
  END IF;
  IF p_payment_provider = 'square' AND p_checkout_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'pp_record_success: a Square payment has no Stripe checkout session' USING ERRCODE = '22023';
  END IF;
  IF p_method IS NULL OR length(btrim(p_method)) = 0 THEN
    RAISE EXCEPTION 'pp_record_success: method is required' USING ERRCODE = '22023';
  END IF;
  -- The account is part of the idempotency key, fixed at claim time. A card
  -- charge reported on another account is a bug to stop on; a link or manual
  -- record keeps the claim's account (the key never changes).
  IF a.method = 'auto_charge' AND NULLIF(p_provider_account, '') IS DISTINCT FROM a.provider_account THEN
    RAISE EXCEPTION 'pp_record_success: attempt % was claimed on account %, provider reported %',
      p_attempt_id, COALESCE(a.provider_account, 'platform'), COALESCE(NULLIF(p_provider_account, ''), 'platform')
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO o FROM payment_plan_occurrences WHERE id = a.occurrence_id FOR UPDATE;
  SELECT * INTO pl FROM payment_plans WHERE id = o.plan_id;
  SELECT vehicle_id INTO v_vehicle FROM rentals WHERE id = o.rental_id;
  v_card := a.method <> 'manual';

  -- status 'Completed' + remaining_amount = amount → the live trigger
  -- auto_fifo_on_payment_insert runs payment_apply_fifo_v2 on this row.
  -- (remaining_amount defaults to 0, which would make the trigger skip it.)
  INSERT INTO payments (
    customer_id, rental_id, vehicle_id, tenant_id, amount, remaining_amount, payment_date, method,
    payment_type, status, booking_source, payment_plan_occurrence_id, platform_account, payment_provider,
    stripe_payment_intent_id, stripe_checkout_session_id, square_payment_id, capture_status, paid_at)
  VALUES (
    pl.customer_id, o.rental_id, v_vehicle, o.tenant_id, p_amount_cents / 100.0, p_amount_cents / 100.0,
    COALESCE(p_payment_date, (pp_clock() AT TIME ZONE pl.timezone)::date), p_method,
    'Payment', 'Completed', 'payment_plan', o.id, p_platform_account, p_payment_provider,
    CASE WHEN v_card AND p_payment_provider = 'stripe' THEN p_provider_ref END,
    CASE WHEN v_card AND p_payment_provider = 'stripe' THEN p_checkout_session_id END,
    CASE WHEN v_card AND p_payment_provider = 'square' THEN p_provider_ref END,
    CASE WHEN v_card THEN 'captured' END,
    pp_clock())
  RETURNING id INTO v_payment;

  UPDATE payment_plan_attempts
     SET status = 'succeeded',
         payment_id = v_payment,
         provider = CASE WHEN a.method = 'manual' THEN 'manual' ELSE p_payment_provider END,
         provider_ref = COALESCE(p_provider_ref, provider_ref),
         provider_mode = COALESCE(p_provider_mode, provider_mode),
         checkout_session_id = COALESCE(p_checkout_session_id, checkout_session_id),
         created_by = COALESCE(p_actor, created_by),
         finished_at = pp_clock()
   WHERE id = a.id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp_record_success: attempt % was not updated', a.id;
  END IF;

  PERFORM pp_settle_occurrence(o.id);
  PERFORM pp__event(o.plan_id, o.id,
                    CASE WHEN a.method = 'manual' THEN 'manual_recorded' ELSE 'charge_succeeded' END,
                    'success:' || a.id, p_amount_cents,
                    jsonb_build_object('attemptId', a.id, 'attemptNo', a.attempt_no, 'paymentId', v_payment,
                                       'method', p_method, 'providerRef', p_provider_ref)
                      || CASE WHEN p_note IS NOT NULL THEN jsonb_build_object('note', p_note) ELSE '{}'::jsonb END,
                    p_actor);
  RETURN v_payment;
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_record_failure(
  p_attempt_id uuid, p_status text, p_provider_ref text DEFAULT NULL, p_decline_code text DEFAULT NULL,
  p_error_code text DEFAULT NULL, p_error_message text DEFAULT NULL, p_next_attempt_at timestamptz DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  a      payment_plan_attempts;
  o      payment_plan_occurrences;
  v_occ  text;
  v_rows integer;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('failed','requires_action','indeterminate','abandoned') THEN
    RAISE EXCEPTION 'pp_record_failure: unknown status %', p_status USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM payment_plan_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_record_failure: attempt % not found', p_attempt_id USING ERRCODE = 'P0002';
  END IF;
  IF a.status = 'succeeded' THEN
    RAISE EXCEPTION 'pp_record_failure: attempt % already succeeded', p_attempt_id USING ERRCODE = '55000';
  END IF;

  UPDATE payment_plan_attempts
     SET status        = p_status,
         provider_ref  = COALESCE(p_provider_ref, provider_ref),
         decline_code  = COALESCE(p_decline_code, decline_code),
         error_code    = COALESCE(p_error_code, error_code),
         error_message = COALESCE(p_error_message, error_message),
         finished_at   = CASE WHEN p_status = 'indeterminate' THEN finished_at ELSE pp_clock() END
   WHERE id = a.id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp_record_failure: attempt % was not updated', a.id;
  END IF;

  SELECT * INTO o FROM payment_plan_occurrences WHERE id = a.occurrence_id FOR UPDATE;
  -- Only a card charge put the occurrence in 'processing'; only then does its
  -- outcome move the occurrence. A failed link or manual attempt changes the
  -- attempt alone.
  IF o.status = 'processing' THEN
    v_occ := CASE p_status
               WHEN 'failed'          THEN 'failed'
               WHEN 'requires_action' THEN 'requires_action'
               WHEN 'indeterminate'   THEN 'processing'     -- recovery replays the same key
               WHEN 'abandoned'       THEN CASE WHEN o.amount_paid > 0 THEN 'partially_paid' ELSE 'due' END
             END;
    UPDATE payment_plan_occurrences
       SET status = v_occ,
           next_attempt_at = CASE WHEN v_occ = 'failed' THEN p_next_attempt_at END
     WHERE id = o.id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'pp_record_failure: occurrence % was not updated', o.id;
    END IF;
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_stale_attempts(p_older_than_seconds integer, p_as_of timestamptz)
 RETURNS SETOF public.payment_plan_attempts
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $$
  SELECT a.*
    FROM payment_plan_attempts a
   WHERE a.status IN ('claimed','in_flight','indeterminate')
     AND a.method <> 'checkout_link'
     AND a.created_at <= p_as_of - make_interval(secs => p_older_than_seconds)
   ORDER BY a.created_at, a.id
$$;


CREATE OR REPLACE FUNCTION public.pp_record_event(p_event jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  k       text;
  v_plan  uuid;
  v_tenant uuid;
  v_rows  integer;
BEGIN
  IF p_event IS NULL OR jsonb_typeof(p_event) <> 'object' THEN
    RAISE EXCEPTION 'pp_record_event: expected a JSON object' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_event) LOOP
    IF k NOT IN ('planId','occurrenceId','kind','dedupeKey','channel','amountCents','detail','actorId','deliveryStatus') THEN
      RAISE EXCEPTION 'pp_record_event: unknown field "%"', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_plan := (p_event->>'planId')::uuid;
  SELECT tenant_id INTO v_tenant FROM payment_plans WHERE id = v_plan;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_record_event: plan % not found', v_plan USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO payment_plan_events (tenant_id, plan_id, occurrence_id, kind, dedupe_key, channel,
                                   delivery_status, amount, detail, actor_id, created_at)
  VALUES (v_tenant, v_plan, (p_event->>'occurrenceId')::uuid, p_event->>'kind', p_event->>'dedupeKey',
          p_event->>'channel', p_event->>'deliveryStatus',
          CASE WHEN p_event ? 'amountCents' AND jsonb_typeof(p_event->'amountCents') = 'number'
               THEN (p_event->>'amountCents')::bigint / 100.0 END,
          COALESCE(p_event->'detail', '{}'::jsonb), (p_event->>'actorId')::uuid, pp_clock())
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_pause_plan(p_plan_id uuid, p_actor uuid DEFAULT NULL, p_reason text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE payment_plans SET status = 'paused', paused_at = pp_clock(), updated_at = pp_clock()
   WHERE id = p_plan_id AND status = 'active';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp_pause_plan: plan % is not active', p_plan_id USING ERRCODE = '55000';
  END IF;
  PERFORM pp__event(p_plan_id, NULL, 'plan_paused', NULL, NULL, jsonb_build_object('reason', p_reason), p_actor);
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_resume_plan(p_plan_id uuid, p_actor uuid DEFAULT NULL, p_reason text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE payment_plans SET status = 'active', paused_at = NULL, updated_at = pp_clock()
   WHERE id = p_plan_id AND status = 'paused';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp_resume_plan: plan % is not paused', p_plan_id USING ERRCODE = '55000';
  END IF;
  PERFORM pp__event(p_plan_id, NULL, 'plan_resumed', NULL, NULL, jsonb_build_object('reason', p_reason), p_actor);
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_cancel_plan(p_plan_id uuid, p_actor uuid DEFAULT NULL, p_reason text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  PERFORM 1 FROM payment_plans WHERE id = p_plan_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM payment_plan_occurrences WHERE plan_id = p_plan_id AND status = 'processing') THEN
    RAISE EXCEPTION 'pp_cancel_plan: plan % has a charge in flight; try again when it settles', p_plan_id
      USING ERRCODE = '55000';
  END IF;
  UPDATE payment_plans SET status = 'cancelled', cancelled_at = pp_clock(), updated_at = pp_clock()
   WHERE id = p_plan_id AND status IN ('active','paused');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp_cancel_plan: plan % is not active or paused', p_plan_id USING ERRCODE = '55000';
  END IF;
  UPDATE payment_plan_attempts a
     SET status = 'abandoned', finished_at = pp_clock(), error_message = 'plan cancelled'
    FROM payment_plan_occurrences o
   WHERE a.occurrence_id = o.id AND o.plan_id = p_plan_id AND a.status IN ('claimed','in_flight');
  UPDATE payment_plan_occurrences SET status = 'cancelled'
   WHERE plan_id = p_plan_id AND status IN ('scheduled','due','failed','requires_action','partially_paid');
  PERFORM pp__event(p_plan_id, NULL, 'plan_cancelled', NULL, NULL, jsonb_build_object('reason', p_reason), p_actor);
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_move_occurrence(p_occurrence_id uuid, p_to date, p_actor uuid DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  o      payment_plan_occurrences;
  pl     payment_plans;
  v_at   timestamptz;
  v_rows integer;
BEGIN
  IF p_to IS NULL THEN
    RAISE EXCEPTION 'pp_move_occurrence: a date is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM payment_plan_occurrences WHERE id = p_occurrence_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_move_occurrence: occurrence % not found', p_occurrence_id USING ERRCODE = 'P0002';
  END IF;
  IF o.status NOT IN ('scheduled','due','failed','requires_action','partially_paid') THEN
    RAISE EXCEPTION 'pp_move_occurrence: occurrence % is %', p_occurrence_id, o.status USING ERRCODE = '55000';
  END IF;
  SELECT * INTO pl FROM payment_plans WHERE id = o.plan_id;
  v_at := pp_due_at(p_to, pl.charge_local_time, pl.timezone);

  UPDATE payment_plan_occurrences
     SET due_date = p_to,
         due_at = v_at,
         moved_from = COALESCE(moved_from, o.due_date),
         -- A failed occurrence moved to a date is retried on that date.
         next_attempt_at = CASE WHEN o.status = 'failed' THEN v_at END
   WHERE id = o.id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp_move_occurrence: occurrence % was not moved', o.id;
  END IF;
  PERFORM pp__event(o.plan_id, o.id, 'occurrence_moved', NULL, NULL,
                    jsonb_build_object('from', to_char(o.due_date, 'YYYY-MM-DD'), 'to', to_char(p_to, 'YYYY-MM-DD')),
                    p_actor);
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_skip_occurrence(p_occurrence_id uuid, p_actor uuid DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  o           payment_plan_occurrences;
  v_next      payment_plan_occurrences;
  v_remaining numeric;
  v_rows      integer;
BEGIN
  SELECT * INTO o FROM payment_plan_occurrences WHERE id = p_occurrence_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_skip_occurrence: occurrence % not found', p_occurrence_id USING ERRCODE = 'P0002';
  END IF;
  IF o.status NOT IN ('scheduled','due','failed','requires_action','partially_paid') THEN
    RAISE EXCEPTION 'pp_skip_occurrence: occurrence % is %', p_occurrence_id, o.status USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM payment_plan_attempts WHERE occurrence_id = o.id AND status IN ('claimed','in_flight')) THEN
    RAISE EXCEPTION 'pp_skip_occurrence: occurrence % has an open attempt', p_occurrence_id USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_next FROM payment_plan_occurrences
   WHERE plan_id = o.plan_id AND seq > o.seq
     AND status IN ('scheduled','due','failed','requires_action','partially_paid')
   ORDER BY seq
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_skip_occurrence: occurrence % is the last open occurrence; its amount has nowhere to go',
      p_occurrence_id USING ERRCODE = '55000';
  END IF;

  v_remaining := GREATEST(o.amount - o.amount_paid, 0);
  UPDATE payment_plan_occurrences SET amount = amount + v_remaining WHERE id = v_next.id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp_skip_occurrence: next occurrence % was not updated', v_next.id;
  END IF;
  UPDATE payment_plan_occurrences SET status = 'skipped' WHERE id = o.id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp_skip_occurrence: occurrence % was not skipped', o.id;
  END IF;
  PERFORM pp__event(o.plan_id, o.id, 'occurrence_skipped', NULL, round(v_remaining * 100)::bigint,
                    jsonb_build_object('rolledInto', v_next.id, 'rolledIntoSeq', v_next.seq), p_actor);
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_set_method(p_occurrence_id uuid, p_method text, p_actor uuid DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  o      payment_plan_occurrences;
  v_rows integer;
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('auto_charge','checkout_link','manual') THEN
    RAISE EXCEPTION 'pp_set_method: unknown method %', p_method USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM payment_plan_occurrences WHERE id = p_occurrence_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_set_method: occurrence % not found', p_occurrence_id USING ERRCODE = 'P0002';
  END IF;
  IF o.status NOT IN ('scheduled','due','failed','requires_action','partially_paid') THEN
    RAISE EXCEPTION 'pp_set_method: occurrence % is %', p_occurrence_id, o.status USING ERRCODE = '55000';
  END IF;
  UPDATE payment_plan_occurrences SET collection_method = p_method WHERE id = o.id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp_set_method: occurrence % was not updated', o.id;
  END IF;
  PERFORM pp__event(o.plan_id, o.id, 'plan_changed', NULL, NULL,
                    jsonb_build_object('occurrenceMethod', jsonb_build_object('from', o.collection_method, 'to', p_method)),
                    p_actor);
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_set_link_token(p_occurrence_id uuid, p_token_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_token_hash IS NULL OR length(btrim(p_token_hash)) = 0 THEN
    RAISE EXCEPTION 'pp_set_link_token: a token hash is required' USING ERRCODE = '22023';
  END IF;
  -- The link_sent event is the engine's to write, after the link is sent.
  UPDATE payment_plan_occurrences SET link_token_hash = p_token_hash WHERE id = p_occurrence_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp_set_link_token: occurrence % not found', p_occurrence_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.pp_set_payment_method(p_plan_id uuid, p_pm text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_pm IS NULL OR length(btrim(p_pm)) = 0 THEN
    RAISE EXCEPTION 'pp_set_payment_method: a payment method id is required' USING ERRCODE = '22023';
  END IF;
  UPDATE payment_plans SET stripe_payment_method_id = p_pm, updated_at = pp_clock() WHERE id = p_plan_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp_set_payment_method: plan % not found', p_plan_id USING ERRCODE = 'P0002';
  END IF;
  PERFORM pp__event(p_plan_id, NULL, 'plan_changed', NULL, NULL,
                    jsonb_build_object('paymentMethodSaved', true), NULL);
END;
$$;


-- ─── Refunds re-settle the occurrence, whoever writes them ─────────────────
-- The Stripe webhooks (charge.refunded), process-refund and the portal's own
-- refund flows update payments.refund_amount / payments.status directly and
-- know nothing of plans. Without this, a refunded plan payment leaves its
-- occurrence 'paid'. With it, the occurrence re-opens (D12: 'due' or
-- 'partially_paid', attempt_no kept), and pp_claim refuses to auto-charge it.
--
-- * Fires only for a payment linked to an occurrence, and only when its
--   refund_amount or status changes.
-- * Cannot recurse: pp_settle_occurrence writes payment_plan_occurrences,
--   payment_plans and payment_plan_events — never payments.
-- * The FIFO's own status writes (Completed → Applied / Partial / Credit, and
--   payment_intent.succeeded's Completed → Applied) also land here; settle
--   counts all of those as paid, so they leave a paid occurrence paid.
-- * SECURITY DEFINER: the portal refunds as `authenticated`, which cannot
--   EXECUTE pp_settle_occurrence itself.
CREATE OR REPLACE FUNCTION public.pp_trg_payment_settles_occurrence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
BEGIN
  PERFORM public.pp_settle_occurrence(NEW.payment_plan_occurrence_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pp_payment_settles_occurrence ON public.payments;
CREATE TRIGGER pp_payment_settles_occurrence
  AFTER UPDATE ON public.payments
  FOR EACH ROW
  WHEN (NEW.payment_plan_occurrence_id IS NOT NULL
        AND (OLD.refund_amount IS DISTINCT FROM NEW.refund_amount OR OLD.status IS DISTINCT FROM NEW.status))
  EXECUTE FUNCTION public.pp_trg_payment_settles_occurrence();


-- ─── Privileges: every pp_* function is service_role only ─────────────────
-- Explicit list (not a LIKE 'pp_%' sweep) so nothing outside this migration
-- can be caught by it.

DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (ARRAY[
         'pp_clock','pp_due_at','pp_occurrence_transition_allowed','pp_trg_occurrence_guard',
         'pp_attempt_transition_allowed','pp_trg_attempt_guard','pp__event','pp__maybe_complete_plan',
         'pp__plan_from_json','pp__plan_to_json','pp__insert_occurrences','pp_get_plan','pp_create_plan',
         'pp_replace_future','pp_collect_due','pp_list_for_reminders','pp_apply_rental_credit',
         'pp_rental_owed_cents','pp_claim','pp_mark_in_flight','pp_settle_occurrence','pp_record_success',
         'pp_record_failure','pp_stale_attempts','pp_record_event','pp_pause_plan','pp_resume_plan',
         'pp_cancel_plan','pp_move_occurrence','pp_skip_occurrence','pp_set_method','pp_set_link_token',
         'pp_set_payment_method','pp_trg_payment_settles_occurrence'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END;
$$;
