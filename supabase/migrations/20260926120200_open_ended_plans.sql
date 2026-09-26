-- @pglite-harness
-- ============================================================================
-- Payment plans — OPEN-ENDED PLANS THAT RENEW THE RENTAL (Wave 3, the green line)
-- docs/PAYMENTS_ROADMAP.md Wave 3 + assumptions A3, A4, A5;
-- docs/PAYMENT_PLANS_UNIFIED_SPEC.md §4, §6.
-- Depends on 20260925120100_payment_plans.sql and
-- 20260925120200_payment_plans_one_engine_per_rental.sql, and on the LIVE,
-- prod-only function finalize_rental_extension (its body is in
-- tests/payment-plans/fixtures/live-functions-2026-09-25.sql).
--
-- NOT APPLIED. A file only. Applying it is a separate, explicit approval.
--
-- THE SHAPE
-- ---------
-- A renewal plan (payment_plans.extends_rental = true, end_kind 'open')
-- renews the rental one PERIOD at a time until it is stopped. One period is
-- one EXISTING-SHAPED extension — exactly what auto-extend-rentals writes:
--   * a rental_extensions row, status 'approved', previous_end_date → new_end_date;
--   * Extension Rental / Extension Tax / Extension Service Fee ledger charges
--     carrying its extension_id, priced by the SAME helpers auto-extend uses
--     (supabase/functions/_shared/payment-plans/renewal-pricing.ts);
--   * Extension Insurance only once a Bonzah policy has been BOUGHT (A4).
-- The period is an occurrence with renews = true. It is posted
-- (pp_post_renewal_period) shortly before it falls due, collected by the
-- normal claim / charge / link / manual path, and when it is PAID the live
-- finalize_rental_extension RPC moves rentals.end_date — in the same
-- transaction as pp_record_success — so the end-date move, the never-shrink
-- guard and the payments.extension_id back-stamp are the same code as today
-- (A3: the end date moves AFTER the period is paid). The operator's Extend
-- may instead "give the days now" (manual extension's order): the end date
-- moves at posting, and the payment later finalizes the extension only.
--
-- WHAT IS PAID, FOR A RENEWAL PERIOD
-- ----------------------------------
-- The ledger says, not the payments linked to the occurrence: amount_paid is
-- what payment_applications have applied to the extension's charges. So a
-- period paid partly by the customer's existing credit and partly by the plan's
-- charge is PAID (auto-extend's credit-then-charge-the-rest), and a period
-- covered in full by credit is paid with no charge at all. A refund does not
-- reopen a renewal period (a refund never reopens ledger charges) — the end
-- date has already moved, and D12 still forbids any automatic re-charge.
--
-- SAFETY RULES THIS FILE ENFORCES (each asserted by a PGlite test)
-- -----------------------------------------------------------------
-- * One extension per occurrence: pp_post_renewal_period is idempotent per
--   occurrence (row lock + extension_id IS NOT NULL → returns it), and
--   ux_payment_plan_occurrences_extension makes a second one a violation.
-- * One occurrence per period: ux_payment_plan_occurrences_renewal_period on
--   (plan_id, period_start) for live renewal periods.
-- * No charge before the period is on the ledger and its insurance is decided:
--   pp_claim returns not_claimable for an unposted or insurance-pending period.
-- * No premium without a policy: pp_record_renewal_insurance adds the
--   Extension Insurance charge only for outcome 'insured' with a policy
--   reference, and never once collection has started (attempt_no > 0).
-- * The end date never moves on a failed charge: it moves only in
--   pp_record_success (after the payment row exists and the period is paid),
--   in the credit-covered / reconcile path (after the ledger shows it paid), or
--   at posting when the operator chose "give the days now".
-- * Never shrink: every end-date move goes forward only.
-- * A renewal plan never completes by itself; only cancel stops it.
-- * A plan change never orphans a posted period: pp_replace_future refuses a
--   renewal plan and never supersedes a renewal period of any plan;
--   pp_skip_occurrence refuses a renewal period and never rolls into one.
--
-- CLOCK: every timestamp goes through pp_clock() (now() in production).
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP … IF EXISTS, CREATE OR REPLACE.
-- ============================================================================


-- ─── Columns ───────────────────────────────────────────────────────────────

ALTER TABLE public.payment_plans
  ADD COLUMN IF NOT EXISTS renewal_period_unit        text,
  ADD COLUMN IF NOT EXISTS renewal_period_count       integer,
  ADD COLUMN IF NOT EXISTS renewal_insurance          jsonb,
  ADD COLUMN IF NOT EXISTS send_agreement_each_period boolean NOT NULL DEFAULT false;

ALTER TABLE public.payment_plans DROP CONSTRAINT IF EXISTS payment_plans_renewal_unit_check;
ALTER TABLE public.payment_plans ADD CONSTRAINT payment_plans_renewal_unit_check
  CHECK (renewal_period_unit IS NULL OR renewal_period_unit IN ('day','week','month'));
ALTER TABLE public.payment_plans DROP CONSTRAINT IF EXISTS payment_plans_renewal_count_range;
ALTER TABLE public.payment_plans ADD CONSTRAINT payment_plans_renewal_count_range
  CHECK (renewal_period_count IS NULL OR renewal_period_count BETWEEN 1 AND 52);
ALTER TABLE public.payment_plans DROP CONSTRAINT IF EXISTS payment_plans_renewal_insurance_shape;
ALTER TABLE public.payment_plans ADD CONSTRAINT payment_plans_renewal_insurance_shape
  CHECK (renewal_insurance IS NULL
         OR (jsonb_typeof(renewal_insurance) = 'object'
             AND (renewal_insurance - ARRAY['cdw','rcli','sli','pai']) = '{}'::jsonb));
-- A renewal plan carries its period and is open-ended; any other plan carries none of it.
ALTER TABLE public.payment_plans DROP CONSTRAINT IF EXISTS payment_plans_renewal_shape;
ALTER TABLE public.payment_plans ADD CONSTRAINT payment_plans_renewal_shape
  CHECK ((extends_rental = false
          AND renewal_period_unit IS NULL AND renewal_period_count IS NULL
          AND renewal_insurance IS NULL AND send_agreement_each_period = false)
      OR (extends_rental = true
          AND renewal_period_unit IS NOT NULL AND renewal_period_count IS NOT NULL
          AND end_kind = 'open'));

ALTER TABLE public.payment_plan_occurrences
  ADD COLUMN IF NOT EXISTS renews           boolean NOT NULL DEFAULT false,
  -- NO ACTION (the default): deleting an extension a plan posted is refused,
  -- so a period can never silently become "unposted" and be posted twice.
  ADD COLUMN IF NOT EXISTS extension_id     uuid REFERENCES public.rental_extensions(id),
  ADD COLUMN IF NOT EXISTS insurance_status text;

ALTER TABLE public.payment_plan_occurrences DROP CONSTRAINT IF EXISTS payment_plan_occurrences_insurance_status_check;
ALTER TABLE public.payment_plan_occurrences ADD CONSTRAINT payment_plan_occurrences_insurance_status_check
  CHECK (insurance_status IS NULL OR insurance_status IN ('none','pending','insured','not_insurable','failed'));
ALTER TABLE public.payment_plan_occurrences DROP CONSTRAINT IF EXISTS payment_plan_occurrences_extension_is_renewal;
ALTER TABLE public.payment_plan_occurrences ADD CONSTRAINT payment_plan_occurrences_extension_is_renewal
  CHECK (extension_id IS NULL OR renews);
-- The insurance decision exists exactly when the period is posted.
ALTER TABLE public.payment_plan_occurrences DROP CONSTRAINT IF EXISTS payment_plan_occurrences_insurance_after_post;
ALTER TABLE public.payment_plan_occurrences ADD CONSTRAINT payment_plan_occurrences_insurance_after_post
  CHECK ((extension_id IS NULL) = (insurance_status IS NULL));
ALTER TABLE public.payment_plan_occurrences DROP CONSTRAINT IF EXISTS payment_plan_occurrences_renewal_has_period;
ALTER TABLE public.payment_plan_occurrences ADD CONSTRAINT payment_plan_occurrences_renewal_has_period
  CHECK (NOT renews OR (period_start IS NOT NULL AND period_end IS NOT NULL));

-- One occurrence per extension; one live occurrence per renewal period.
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_plan_occurrences_extension
  ON public.payment_plan_occurrences (extension_id) WHERE extension_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_plan_occurrences_renewal_period
  ON public.payment_plan_occurrences (plan_id, period_start)
  WHERE renews AND status NOT IN ('superseded','cancelled');

ALTER TABLE public.payment_plan_events DROP CONSTRAINT IF EXISTS payment_plan_events_kind_check;
ALTER TABLE public.payment_plan_events ADD CONSTRAINT payment_plan_events_kind_check CHECK (kind IN (
  'plan_created','plan_changed','plan_paused','plan_resumed','plan_cancelled',
  'plan_completed','occurrence_due','reminder','link_sent','charge_attempted',
  'charge_succeeded','charge_failed','requires_action','fallback_to_link',
  'manual_recorded','occurrence_moved','occurrence_skipped','occurrence_waived',
  'occurrence_paid','covered_by_balance',
  'period_posted','insurance_bought','insurance_not_bought','rental_extended','agreement_choice'));


-- ─── State machine guard: a period's renewal identity is immutable ─────────
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
    -- A period is posted only by pp_post_renewal_period, never born posted.
    IF NEW.extension_id IS NOT NULL THEN
      RAISE EXCEPTION 'payment_plan_occurrences: a new occurrence cannot carry an extension'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.seq IS DISTINCT FROM OLD.seq
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.rental_id IS DISTINCT FROM OLD.rental_id THEN
    RAISE EXCEPTION 'payment_plan_occurrences: plan_id, seq, tenant_id and rental_id are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Once posted, a period keeps its extension; and a period is a renewal for life.
  IF NEW.renews IS DISTINCT FROM OLD.renews
     OR (OLD.extension_id IS NOT NULL AND NEW.extension_id IS DISTINCT FROM OLD.extension_id) THEN
    RAISE EXCEPTION 'payment_plan_occurrences: renews and a posted extension_id are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT public.pp_occurrence_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'payment_plan_occurrences: illegal transition % -> % (occurrence %)', OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> 'failed' THEN
    NEW.next_attempt_at := NULL;
  END IF;
  NEW.updated_at := public.pp_clock();
  RETURN NEW;
END;
$$;


-- ─── Plan JSON: the renewal block ──────────────────────────────────────────
-- pp__plan_from_json: as 20260925120100, plus the optional `renewal` key
-- (types.ts PlanRenewal). Everything else is unchanged.
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
  v_ren  jsonb;
  v_ins  jsonb;
  k      text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'payment plan: expected a JSON object' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p) LOOP
    IF k NOT IN ('tenantId','rentalId','customerId','rule','amount','currency','timezone','chargeLocalTime',
                 'collectionMethod','fallbackToLink','maxAttempts','retryAfterDays','reminderOffsets',
                 'paymentProvider','stripePaymentMethodId','extendsRental','renewal',
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

  -- The renewal block (types.ts PlanRenewal). Absent or null = not a renewal plan.
  v_ren := p->'renewal';
  r.send_agreement_each_period := false;
  IF v_ren IS NOT NULL AND jsonb_typeof(v_ren) <> 'null' THEN
    IF jsonb_typeof(v_ren) <> 'object' THEN
      RAISE EXCEPTION 'payment plan: renewal must be an object' USING ERRCODE = '22023';
    END IF;
    FOR k IN SELECT jsonb_object_keys(v_ren) LOOP
      IF k NOT IN ('periodUnit','periodCount','insurance','sendAgreementEachPeriod') THEN
        RAISE EXCEPTION 'payment plan: unknown renewal field "%"', k USING ERRCODE = '22023';
      END IF;
    END LOOP;
    r.renewal_period_unit  := v_ren->>'periodUnit';
    r.renewal_period_count := (v_ren->>'periodCount')::integer;
    v_ins := v_ren->'insurance';
    IF v_ins IS NOT NULL AND jsonb_typeof(v_ins) <> 'null' THEN
      IF jsonb_typeof(v_ins) <> 'object' THEN
        RAISE EXCEPTION 'payment plan: renewal.insurance must be an object' USING ERRCODE = '22023';
      END IF;
      FOR k IN SELECT jsonb_object_keys(v_ins) LOOP
        IF k NOT IN ('cdw','rcli','sli','pai') OR jsonb_typeof(v_ins->k) <> 'boolean' THEN
          RAISE EXCEPTION 'payment plan: renewal.insurance.% must be one of cdw/rcli/sli/pai, true or false', k
            USING ERRCODE = '22023';
        END IF;
      END LOOP;
      r.renewal_insurance := v_ins;
    END IF;
    r.send_agreement_each_period := COALESCE((v_ren->>'sendAgreementEachPeriod')::boolean, false);
  END IF;

  IF r.timezone IS NULL THEN
    RAISE EXCEPTION 'payment plan: timezone is required' USING ERRCODE = '22023';
  END IF;
  PERFORM now() AT TIME ZONE r.timezone;
  RETURN r;
END;
$$;

-- pp__plan_to_json: as 20260925120100, plus `renewal` on a renewal plan only
-- (so a plan without one serialises exactly as before).
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
  || CASE WHEN r.extends_rental THEN jsonb_build_object('renewal', jsonb_build_object(
       'periodUnit', r.renewal_period_unit,
       'periodCount', r.renewal_period_count,
       'insurance', r.renewal_insurance,
       'sendAgreementEachPeriod', r.send_agreement_each_period))
     ELSE '{}'::jsonb END
$$;

-- pp__insert_occurrences: as 20260925120100; every occurrence of a renewal
-- plan is a renewal period (renews = extends_rental) and must carry its period.
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
    IF p_plan.extends_rental AND ((d->>'periodStart') IS NULL OR (d->>'periodEnd') IS NULL) THEN
      RAISE EXCEPTION 'occurrence draft: a renewal period needs periodStart and periodEnd' USING ERRCODE = '22023';
    END IF;
    v_due_at := pp_due_at(v_date, p_plan.charge_local_time, p_plan.timezone);
    IF d ? 'dueAt' AND (d->>'dueAt')::timestamptz IS DISTINCT FROM v_due_at THEN
      RAISE EXCEPTION 'occurrence draft: dueAt % disagrees with Postgres (%)', d->>'dueAt', v_due_at
        USING ERRCODE = '22023';
    END IF;
    v_n := v_n + 1;
    INSERT INTO payment_plan_occurrences (
      tenant_id, plan_id, rental_id, seq, plan_version, due_date, due_at,
      period_start, period_end, amount, collection_method, status, renews, created_at, updated_at)
    VALUES (
      p_plan.tenant_id, p_plan.id, p_plan.rental_id, v_base + v_n, p_plan.version, v_date, v_due_at,
      (d->>'periodStart')::date, (d->>'periodEnd')::date,
      (d->>'amountCents')::bigint / 100.0,
      COALESCE(d->>'collectionMethod', p_plan.collection_method),
      'scheduled', p_plan.extends_rental, pp_clock(), pp_clock());
  END LOOP;
  RETURN v_n;
END;
$$;

-- pp__maybe_complete_plan: a renewal plan is open-ended — it never completes
-- because its current period is paid (the next one is about to be appended).
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
     AND extends_rental = false
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


-- ─── Creation and change ───────────────────────────────────────────────────
-- pp_create_plan: as 20260925120100, plus: a renewal plan's first period
-- starts on the rental's current end date — no gap (free days) and no overlap
-- (days billed twice).
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
  IF v_rental.tenant_id IS DISTINCT FROM r.tenant_id THEN
    RAISE EXCEPTION 'pp_create_plan: rental % does not belong to tenant %', r.rental_id, r.tenant_id
      USING ERRCODE = '42501';
  END IF;
  IF v_rental.customer_id IS DISTINCT FROM r.customer_id THEN
    RAISE EXCEPTION 'pp_create_plan: rental % does not belong to customer %', r.rental_id, r.customer_id
      USING ERRCODE = '42501';
  END IF;
  IF r.extends_rental AND (v_rental.end_date IS NULL OR r.anchor_date IS DISTINCT FROM v_rental.end_date) THEN
    RAISE EXCEPTION 'pp_create_plan: a renewing plan starts on the rental''s end date (%), not %',
      v_rental.end_date, r.anchor_date USING ERRCODE = '22023';
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
  -- A renewal plan is created with its FIRST period only (the engine appends
  -- each next one when the last is settled), and that period starts on the
  -- rental's end date.
  IF r.extends_rental AND (v_n <> 1 OR NOT EXISTS (
       SELECT 1 FROM payment_plan_occurrences WHERE plan_id = r.id AND period_start = r.anchor_date)) THEN
    RAISE EXCEPTION 'pp_create_plan: a renewing plan is created with exactly one period, starting on % (got %)',
      r.anchor_date, v_n USING ERRCODE = '22023';
  END IF;
  PERFORM pp__event(r.id, NULL, 'plan_created', NULL, NULL,
                    jsonb_build_object('occurrences', v_n, 'version', 1), p_actor);
  RETURN r.id;
END;
$$;

-- pp_replace_future: as 20260925120100, except that (1) a renewal plan has no
-- schedule to replace — it is refused; (2) a renewal period on any other plan
-- (an operator's Extend) is NEVER superseded: its extension and charges are on
-- the ledger and the plan must go on collecting them.
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
  IF c.extends_rental THEN
    RAISE EXCEPTION 'pp_replace_future: plan % renews the rental; it has no schedule to change — cancel it and set up a new one', p_plan_id
      USING ERRCODE = '55000';
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

  UPDATE payment_plan_attempts a
     SET status = 'abandoned', finished_at = pp_clock(), error_message = 'superseded by a plan change'
    FROM payment_plan_occurrences o
   WHERE a.occurrence_id = o.id AND o.plan_id = p_plan_id
     AND o.renews = false
     AND o.status IN ('scheduled','due','failed','requires_action','partially_paid')
     AND a.status IN ('claimed','in_flight');
  UPDATE payment_plan_occurrences
     SET status = 'superseded'
   WHERE plan_id = p_plan_id
     AND renews = false
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

-- pp_skip_occurrence: as 20260925120100, except that a renewal period cannot
-- be skipped (its extension and charges are real; cancel the plan to stop
-- renewing) and a skipped amount never rolls INTO a renewal period (that
-- would put money the ledger does not owe on an extension).
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
  IF o.renews THEN
    RAISE EXCEPTION 'pp_skip_occurrence: occurrence % is a renewal period; cancel the plan to stop renewing', p_occurrence_id
      USING ERRCODE = '55000';
  END IF;
  IF o.status NOT IN ('scheduled','due','failed','requires_action','partially_paid') THEN
    RAISE EXCEPTION 'pp_skip_occurrence: occurrence % is %', p_occurrence_id, o.status USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM payment_plan_attempts WHERE occurrence_id = o.id AND status IN ('claimed','in_flight')) THEN
    RAISE EXCEPTION 'pp_skip_occurrence: occurrence % has an open attempt', p_occurrence_id USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_next FROM payment_plan_occurrences
   WHERE plan_id = o.plan_id AND seq > o.seq AND renews = false
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


-- ─── What a renewal period owes, and what has been paid on it ──────────────

-- Σ open remaining of the extension's charges, in cents, floor 0.
CREATE OR REPLACE FUNCTION public.pp_extension_owed_cents(p_extension_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $$
  SELECT GREATEST(0, round(100 * COALESCE(sum(le.remaining_amount), 0)))::bigint
    FROM ledger_entries le
   WHERE le.extension_id = p_extension_id
     AND le.type = 'Charge'
     AND le.remaining_amount > 0
$$;

-- Σ money APPLIED to the extension's charges (payment_applications), in cents.
-- Real payments only: a charge zeroed by hand (a write-off) is not "paid".
CREATE OR REPLACE FUNCTION public.pp__extension_applied_cents(p_extension_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $$
  SELECT GREATEST(0, round(100 * COALESCE(sum(pa.amount_applied), 0)))::bigint
    FROM payment_applications pa
    JOIN ledger_entries le ON le.id = pa.charge_entry_id
   WHERE le.extension_id = p_extension_id
     AND le.type = 'Charge'
$$;

-- pp_settle_occurrence: as 20260925120100, except that a POSTED renewal period
-- is paid by what the ledger has applied to its extension's charges (credit
-- and payments outside the plan included), capped at its amount.
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

  SELECT GREATEST(COALESCE(sum(p.amount - COALESCE(p.refund_amount, 0))
                    FILTER (WHERE p.status IN ('Applied','Credit','Partial','Completed','Partial Refund','Refunded')), 0), 0),
         count(*)
    INTO v_paid, v_n
    FROM payments p
   WHERE p.payment_plan_occurrence_id = o.id
     AND p.capture_status IS DISTINCT FROM 'requires_capture';

  IF o.extension_id IS NOT NULL THEN
    v_paid := LEAST(o.amount, pp__extension_applied_cents(o.extension_id) / 100.0);
  END IF;

  v_new := o.status;
  IF o.status IN ('superseded','cancelled','waived','skipped') THEN
    v_new := o.status;
  ELSIF v_paid >= o.amount THEN
    v_new := 'paid';
  ELSIF v_paid > 0 THEN
    v_new := 'partially_paid';
  ELSIF v_n > 0 AND o.status IN ('paid','partially_paid') THEN
    v_new := 'due';
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


-- ─── Moving the end date (forward only) ────────────────────────────────────

-- The rental half of finalize_rental_extension, line for line (live body,
-- tests/payment-plans/fixtures/live-functions-2026-09-25.sql): the end date
-- moves only FORWARD; previous/original end dates are stamped once. Used
-- where there is no payment to hand finalize_rental_extension — "give the
-- days now", and a period the ledger shows paid by credit or outside the plan
-- (auto-extend's prod-only finalize_credit_covered_extension, whose body is
-- not in the repo). Returns whether end_date moved.
CREATE OR REPLACE FUNCTION public.pp__extend_rental_end(p_rental_id uuid, p_previous_end date, p_new_end date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_current date;
  v_rows    integer;
BEGIN
  SELECT r.end_date INTO v_current FROM rentals r WHERE r.id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp__extend_rental_end: rental % not found', p_rental_id USING ERRCODE = 'P0002';
  END IF;
  IF p_new_end IS NOT NULL AND (v_current IS NULL OR p_new_end > v_current) THEN
    UPDATE rentals r
       SET end_date = p_new_end,
           is_extended = false,
           extension_checkout_url = NULL,
           extension_amount = NULL,
           previous_end_date = COALESCE(r.previous_end_date, p_previous_end),
           original_end_date = COALESCE(r.original_end_date, p_previous_end),
           updated_at = pp_clock()
     WHERE r.id = p_rental_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'pp__extend_rental_end: rental % was not updated', p_rental_id;
    END IF;
    RETURN true;
  END IF;
  UPDATE rentals SET is_extended = false, extension_checkout_url = NULL, extension_amount = NULL, updated_at = pp_clock()
   WHERE id = p_rental_id;
  RETURN false;
END;
$$;

-- The extension half of finalize_rental_extension without a payment row:
-- status → paid (a refunded one stays refunded), paid_at stamped once,
-- paid_amount = what the ledger applied. Then the end date moves forward.
CREATE OR REPLACE FUNCTION public.pp__finalize_extension_by_ledger(p_extension_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_rental  uuid;
  v_prev    date;
  v_new     date;
  v_applied bigint;
  v_rows    integer;
BEGIN
  SELECT re.rental_id, re.previous_end_date, re.new_end_date
    INTO v_rental, v_prev, v_new
    FROM rental_extensions re WHERE re.id = p_extension_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rental_extension % not found', p_extension_id USING ERRCODE = 'P0002';
  END IF;
  v_applied := pp__extension_applied_cents(p_extension_id);
  UPDATE rental_extensions re
     SET status = CASE WHEN re.status = 'refunded' THEN 'refunded' ELSE 'paid' END,
         paid_at = COALESCE(re.paid_at, pp_clock()),
         paid_amount = GREATEST(re.paid_amount, v_applied / 100.0),
         updated_at = pp_clock()
   WHERE re.id = p_extension_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp__finalize_extension_by_ledger: extension % was not updated', p_extension_id;
  END IF;
  RETURN pp__extend_rental_end(v_rental, v_prev, v_new);
END;
$$;

-- Settle a posted renewal period from the ledger; when it is paid, finalize
-- its extension (no payment row: credit, or money taken outside the plan) and
-- record it. Returns the occurrence's resulting status.
CREATE OR REPLACE FUNCTION public.pp__settle_renewal_period(p_occurrence_id uuid, p_via text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  o       payment_plan_occurrences;
  v_moved boolean;
  v_end   date;
BEGIN
  o := pp_settle_occurrence(p_occurrence_id);
  IF o.extension_id IS NULL THEN
    RAISE EXCEPTION 'pp__settle_renewal_period: occurrence % is not a posted renewal period', p_occurrence_id
      USING ERRCODE = '22023';
  END IF;
  IF o.status = 'paid' THEN
    v_moved := pp__finalize_extension_by_ledger(o.extension_id);
    SELECT end_date INTO v_end FROM rentals WHERE id = o.rental_id;
    PERFORM pp__event(o.plan_id, o.id, 'rental_extended', 'rental_extended:' || o.id, NULL,
                      jsonb_build_object('extensionId', o.extension_id, 'via', p_via, 'endDateMoved', v_moved,
                                         'endDate', to_char(v_end, 'YYYY-MM-DD')), NULL);
  END IF;
  RETURN o.status;
END;
$$;


-- ─── The claim: a renewal period collects what its extension still owes ────
-- pp_claim: as 20260925120100, plus for a renewal period:
--   * not claimable until it is posted and its insurance decided;
--   * the cap (D5) is what the EXTENSION's charges still owe after the
--     rental's credit is applied — auto-extend's "bill only the remaining";
--   * nothing owed → the period is PAID by the ledger (credit, or money taken
--     outside the plan) and its end date moves; a written-off period (nothing
--     owed, nothing applied) is skipped and its end date stays.
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
  v_status    text;
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('auto_charge','checkout_link','manual') THEN
    RAISE EXCEPTION 'pp_claim: unknown method %', p_method USING ERRCODE = '22023';
  END IF;

  SELECT * INTO o FROM payment_plan_occurrences WHERE id = p_occurrence_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_claim: occurrence % not found', p_occurrence_id USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO pl FROM payment_plans WHERE id = o.plan_id;

  IF EXISTS (SELECT 1 FROM payment_plan_attempts
              WHERE occurrence_id = o.id AND status IN ('claimed','in_flight')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'held_elsewhere');
  END IF;

  IF NOT (o.status IN ('due','failed','requires_action','partially_paid')
          OR (o.status = 'scheduled' AND p_method = 'manual')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_claimable');
  END IF;
  IF pl.status = 'cancelled' OR (p_method <> 'manual' AND pl.status <> 'active') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_claimable');
  END IF;
  -- A renewal period is collected only once it is on the ledger and its
  -- insurance is decided: never a charge for days with no extension behind
  -- them, never a charge that a premium could still be added to.
  IF o.renews AND (o.extension_id IS NULL OR o.insurance_status = 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_claimable');
  END IF;
  IF p_method = 'auto_charge' AND EXISTS (
       SELECT 1 FROM payments p
        WHERE p.payment_plan_occurrence_id = o.id
          AND (COALESCE(p.refund_amount, 0) > 0 OR p.status IN ('Refunded','Partial Refund','Reversed'))) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_claimable');
  END IF;

  PERFORM pp_apply_rental_credit(o.rental_id);
  IF o.extension_id IS NOT NULL THEN
    v_owed := pp_extension_owed_cents(o.extension_id);
  ELSE
    v_owed := pp_rental_owed_cents(o.rental_id);
  END IF;
  v_remaining := GREATEST(round((o.amount - o.amount_paid) * 100)::bigint, 0);
  v_amount    := LEAST(v_remaining, v_owed);

  IF v_amount <= 0 THEN
    IF o.extension_id IS NOT NULL THEN
      v_status := pp__settle_renewal_period(o.id, 'credit');
      IF v_status <> 'paid' THEN
        UPDATE payment_plan_occurrences SET status = 'skipped' WHERE id = o.id;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows <> 1 THEN
          RAISE EXCEPTION 'pp_claim: occurrence % was not skipped', o.id;
        END IF;
      END IF;
    ELSE
      UPDATE payment_plan_occurrences SET status = 'skipped' WHERE id = o.id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RAISE EXCEPTION 'pp_claim: occurrence % was not skipped', o.id;
      END IF;
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


-- ─── Success: the payment pays THIS extension, and the end date moves ─────
-- pp_record_success: as 20260925120100, plus for a posted renewal period:
--   * the payments row carries extension_id and the Extension* target
--     categories (auto-extend's auto-charge row), so the live FIFO applies it
--     to this extension's charges and nothing else;
--   * a MANUAL record may not exceed what the period still owes (the excess
--     would be credit locked to this extension forever); a card or link
--     payment that does (priced while other charges were open) has its rest
--     released to the rental's other charges;
--   * when the period is now paid, the LIVE finalize_rental_extension moves
--     rentals.end_date, in this same transaction. If finalize fails, nothing
--     is recorded and the engine refunds the charge (design §7).
CREATE OR REPLACE FUNCTION public.pp_record_success(
  p_attempt_id uuid, p_amount_cents bigint, p_provider_ref text, p_provider_account text,
  p_provider_mode text, p_payment_provider text, p_platform_account text, p_payment_date date,
  p_method text, p_checkout_session_id text DEFAULT NULL,
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
  v_ext      uuid;
  v_ext_owed bigint;
  v_status   text;
  v_moved    boolean;
  v_end      date;
BEGIN
  SELECT * INTO a FROM payment_plan_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_record_success: attempt % not found', p_attempt_id USING ERRCODE = 'P0002';
  END IF;

  IF a.status = 'succeeded' THEN
    IF a.payment_id IS NULL THEN
      RAISE EXCEPTION 'pp_record_success: attempt % succeeded without a payment', p_attempt_id;
    END IF;
    RETURN a.payment_id;
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'pp_record_success: amount must be positive cents (got %)', p_amount_cents USING ERRCODE = '22023';
  END IF;
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
  IF a.method = 'auto_charge' AND NULLIF(p_provider_account, '') IS DISTINCT FROM a.provider_account THEN
    RAISE EXCEPTION 'pp_record_success: attempt % was claimed on account %, provider reported %',
      p_attempt_id, COALESCE(a.provider_account, 'platform'), COALESCE(NULLIF(p_provider_account, ''), 'platform')
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO o FROM payment_plan_occurrences WHERE id = a.occurrence_id FOR UPDATE;
  SELECT * INTO pl FROM payment_plans WHERE id = o.plan_id;
  SELECT vehicle_id INTO v_vehicle FROM rentals WHERE id = o.rental_id;
  v_card := a.method <> 'manual';
  v_ext  := o.extension_id;

  IF v_ext IS NOT NULL AND a.method = 'manual' THEN
    v_ext_owed := pp_extension_owed_cents(v_ext);
    IF p_amount_cents > v_ext_owed THEN
      RAISE EXCEPTION 'pp_record_success: this renewal period owes % cents; a manual record of % cents would leave the difference stuck on it — record the rest as a payment on the rental',
        v_ext_owed, p_amount_cents USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO payments (
    customer_id, rental_id, vehicle_id, tenant_id, amount, remaining_amount, payment_date, method,
    payment_type, status, booking_source, payment_plan_occurrence_id, platform_account, payment_provider,
    stripe_payment_intent_id, stripe_checkout_session_id, square_payment_id, capture_status, paid_at,
    extension_id, target_categories)
  VALUES (
    pl.customer_id, o.rental_id, v_vehicle, o.tenant_id, p_amount_cents / 100.0, p_amount_cents / 100.0,
    COALESCE(p_payment_date, (pp_clock() AT TIME ZONE pl.timezone)::date), p_method,
    'Payment', 'Completed', 'payment_plan', o.id, p_platform_account, p_payment_provider,
    CASE WHEN v_card AND p_payment_provider = 'stripe' THEN p_provider_ref END,
    CASE WHEN v_card AND p_payment_provider = 'stripe' THEN p_checkout_session_id END,
    CASE WHEN v_card AND p_payment_provider = 'square' THEN p_provider_ref END,
    CASE WHEN v_card THEN 'captured' END,
    pp_clock(),
    v_ext,
    CASE WHEN v_ext IS NOT NULL
         THEN '["Extension Rental","Extension Tax","Extension Service Fee","Extension Add-on","Extension Insurance"]'::jsonb END)
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

  -- More than the period still owed (a link priced while other charges were
  -- open, or the period settled meanwhile): the rest must not stay locked to
  -- this extension. Drop the targets and let the live FIFO apply what is left
  -- to the rental's OTHER charges, exactly as a plain payment would (it still
  -- carries extension_id, so no other extension's charges are touched).
  IF v_ext IS NOT NULL AND EXISTS (SELECT 1 FROM payments WHERE id = v_payment AND COALESCE(remaining_amount, 0) > 0) THEN
    UPDATE payments SET target_categories = NULL WHERE id = v_payment;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'pp_record_success: payment % was not released to the rental', v_payment;
    END IF;
    PERFORM payment_apply_fifo_v2(v_payment);
  END IF;

  PERFORM pp_settle_occurrence(o.id);
  PERFORM pp__event(o.plan_id, o.id,
                    CASE WHEN a.method = 'manual' THEN 'manual_recorded' ELSE 'charge_succeeded' END,
                    'success:' || a.id, p_amount_cents,
                    jsonb_build_object('attemptId', a.id, 'attemptNo', a.attempt_no, 'paymentId', v_payment,
                                       'method', p_method, 'providerRef', p_provider_ref)
                      || CASE WHEN p_note IS NOT NULL THEN jsonb_build_object('note', p_note) ELSE '{}'::jsonb END,
                    p_actor);

  IF v_ext IS NOT NULL THEN
    SELECT status INTO v_status FROM payment_plan_occurrences WHERE id = o.id;
    IF v_status = 'paid' THEN
      SELECT f.out_end_date_updated INTO v_moved FROM public.finalize_rental_extension(v_ext, v_payment) f;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'pp_record_success: finalize_rental_extension returned nothing for extension %', v_ext;
      END IF;
      SELECT end_date INTO v_end FROM rentals WHERE id = o.rental_id;
      PERFORM pp__event(o.plan_id, o.id, 'rental_extended', 'rental_extended:' || o.id, NULL,
                        jsonb_build_object('extensionId', v_ext, 'via', 'payment', 'paymentId', v_payment,
                                           'endDateMoved', COALESCE(v_moved, false), 'endDate', to_char(v_end, 'YYYY-MM-DD')),
                        p_actor);
    END IF;
  END IF;
  RETURN v_payment;
END;
$$;


-- ─── The renewal chain ─────────────────────────────────────────────────────

-- Append ONE renewal period to a plan. The period must start where the chain
-- ends — GREATEST(rentals.end_date, the last live period's end) — so a period
-- can neither leave free days nor bill days twice. Idempotent per period: a
-- live renewal occurrence for the same start is returned, not duplicated (and
-- ux_payment_plan_occurrences_renewal_period makes a racing second insert a
-- violation). Works on any active plan: a renewal plan's automatic next
-- period, or an operator's Extend on any plan.
CREATE OR REPLACE FUNCTION public.pp_append_renewal_period(p_plan_id uuid, p_draft jsonb, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  pl       payment_plans;
  k        text;
  v_start  date;
  v_end    date;
  v_due    date;
  v_cents  bigint;
  v_chain  date;
  v_rend   date;
  v_id     uuid;
  v_seq    integer;
  v_rows   integer;
BEGIN
  IF p_draft IS NULL OR jsonb_typeof(p_draft) <> 'object' THEN
    RAISE EXCEPTION 'pp_append_renewal_period: a draft is required' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_draft) LOOP
    IF k NOT IN ('seq','dueDate','periodStart','periodEnd','days','amountCents','isStub','dueAt') THEN
      RAISE EXCEPTION 'pp_append_renewal_period: unknown field "%"', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_start := (p_draft->>'periodStart')::date;
  v_end   := (p_draft->>'periodEnd')::date;
  v_due   := (p_draft->>'dueDate')::date;
  v_cents := (p_draft->>'amountCents')::bigint;
  IF v_start IS NULL OR v_end IS NULL OR v_due IS NULL OR v_end <= v_start THEN
    RAISE EXCEPTION 'pp_append_renewal_period: a period needs dueDate and periodStart < periodEnd' USING ERRCODE = '22023';
  END IF;
  IF p_draft ? 'days' AND (p_draft->>'days')::integer <> (v_end - v_start) THEN
    RAISE EXCEPTION 'pp_append_renewal_period: days % disagrees with the period (% days)', p_draft->>'days', v_end - v_start
      USING ERRCODE = '22023';
  END IF;
  IF v_cents IS NULL OR v_cents < 1 THEN
    RAISE EXCEPTION 'pp_append_renewal_period: amount must be at least 1 cent' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO pl FROM payment_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_append_renewal_period: plan % not found', p_plan_id USING ERRCODE = 'P0002';
  END IF;
  IF pl.status <> 'active' THEN
    RAISE EXCEPTION 'pp_append_renewal_period: plan % is %', p_plan_id, pl.status USING ERRCODE = '55000';
  END IF;

  SELECT id INTO v_id FROM payment_plan_occurrences
   WHERE plan_id = p_plan_id AND renews AND period_start = v_start AND status NOT IN ('superseded','cancelled');
  IF FOUND THEN
    RETURN jsonb_build_object('occurrenceId', v_id, 'appended', false);
  END IF;

  SELECT end_date INTO v_rend FROM rentals WHERE id = pl.rental_id;
  SELECT GREATEST(v_rend, max(period_end)) INTO v_chain FROM payment_plan_occurrences
   WHERE plan_id = p_plan_id AND renews AND status NOT IN ('superseded','cancelled');
  v_chain := COALESCE(v_chain, v_rend);
  IF v_chain IS NULL OR v_start <> v_chain THEN
    RAISE EXCEPTION 'pp_append_renewal_period: the next period starts on % (the rental''s end, or the last period''s end), not %',
      v_chain, v_start USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM payment_plan_occurrences WHERE plan_id = p_plan_id;
  INSERT INTO payment_plan_occurrences (
    tenant_id, plan_id, rental_id, seq, plan_version, due_date, due_at,
    period_start, period_end, amount, collection_method, status, renews, created_at, updated_at)
  VALUES (
    pl.tenant_id, pl.id, pl.rental_id, v_seq, pl.version, v_due,
    pp_due_at(v_due, pl.charge_local_time, pl.timezone),
    v_start, v_end, v_cents / 100.0, pl.collection_method, 'scheduled', true, pp_clock(), pp_clock())
  RETURNING id INTO v_id;

  -- An open plan's horizon is its last materialised due date.
  IF pl.end_kind = 'open' THEN
    UPDATE payment_plans SET until_date = GREATEST(until_date, v_due), updated_at = pp_clock()
     WHERE id = p_plan_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'pp_append_renewal_period: plan % was not updated', p_plan_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('occurrenceId', v_id, 'appended', true);
END;
$$;


-- Post ONE renewal period: its rental_extensions row and its Extension*
-- ledger charges, atomically, exactly the categories and amounts
-- auto-extend-rentals writes (renewal-pricing.ts prices it; this checks the
-- arithmetic). Idempotent per occurrence: a posted period returns its
-- extension and writes nothing. With p_give_days_now (the operator's Extend,
-- A3) the rental's end date moves now, forward only.
CREATE OR REPLACE FUNCTION public.pp_post_renewal_period(
  p_occurrence_id uuid, p_breakdown jsonb, p_insurance_requested boolean DEFAULT false,
  p_give_days_now boolean DEFAULT false, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  o         payment_plan_occurrences;
  pl        payment_plans;
  v_rental  rentals;
  k         text;
  v_rent    bigint;
  v_tax     bigint;
  v_fee     bigint;
  v_total   bigint;
  v_seq     integer;
  v_ext     uuid;
  v_days    integer;
  v_today   date;
  v_want    integer;
  v_rows    integer;
  v_moved   boolean := false;
  v_ref     text;
BEGIN
  IF p_breakdown IS NULL OR jsonb_typeof(p_breakdown) <> 'object' THEN
    RAISE EXCEPTION 'pp_post_renewal_period: a breakdown is required' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_breakdown) LOOP
    IF k NOT IN ('rentalCents','taxCents','serviceFeeCents','totalCents') THEN
      RAISE EXCEPTION 'pp_post_renewal_period: unknown breakdown field "%"', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_rent  := (p_breakdown->>'rentalCents')::bigint;
  v_tax   := (p_breakdown->>'taxCents')::bigint;
  v_fee   := (p_breakdown->>'serviceFeeCents')::bigint;
  v_total := (p_breakdown->>'totalCents')::bigint;
  IF v_rent IS NULL OR v_tax IS NULL OR v_fee IS NULL OR v_total IS NULL
     OR v_rent < 0 OR v_tax < 0 OR v_fee < 0 OR v_total <> v_rent + v_tax + v_fee OR v_total < 1 THEN
    RAISE EXCEPTION 'pp_post_renewal_period: breakdown must be whole cents ≥ 0 whose total (≥ 1) is their sum (got %)', p_breakdown
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO o FROM payment_plan_occurrences WHERE id = p_occurrence_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_post_renewal_period: occurrence % not found', p_occurrence_id USING ERRCODE = 'P0002';
  END IF;
  IF NOT o.renews THEN
    RAISE EXCEPTION 'pp_post_renewal_period: occurrence % is not a renewal period', p_occurrence_id USING ERRCODE = '22023';
  END IF;
  -- Idempotent: one extension per occurrence, whatever called us twice.
  IF o.extension_id IS NOT NULL THEN
    SELECT sequence_number INTO v_seq FROM rental_extensions WHERE id = o.extension_id;
    RETURN jsonb_build_object('extensionId', o.extension_id, 'posted', false, 'sequenceNumber', v_seq, 'endDateMoved', false);
  END IF;
  IF o.status NOT IN ('scheduled','due') OR o.attempt_no <> 0 THEN
    RAISE EXCEPTION 'pp_post_renewal_period: occurrence % is % with % attempt(s); only an untouched period can be posted',
      p_occurrence_id, o.status, o.attempt_no USING ERRCODE = '55000';
  END IF;
  SELECT * INTO pl FROM payment_plans WHERE id = o.plan_id;
  IF pl.status <> 'active' THEN
    RAISE EXCEPTION 'pp_post_renewal_period: plan % is %', o.plan_id, pl.status USING ERRCODE = '55000';
  END IF;

  -- The rental row lock serialises extension numbering (and any end-date move).
  SELECT * INTO v_rental FROM rentals WHERE id = o.rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_post_renewal_period: rental % not found', o.rental_id USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(max(sequence_number), 0) + 1 INTO v_seq FROM rental_extensions WHERE rental_id = o.rental_id;
  v_days  := o.period_end - o.period_start;
  v_today := (pp_clock() AT TIME ZONE pl.timezone)::date;

  INSERT INTO rental_extensions (
    rental_id, tenant_id, sequence_number, status, previous_end_date, new_end_date, extension_days,
    rental_amount, tax_amount, service_fee_amount, insurance_amount, requested_at, approved_at)
  VALUES (
    o.rental_id, o.tenant_id, v_seq, 'approved', o.period_start, o.period_end, v_days,
    v_rent / 100.0, v_tax / 100.0, v_fee / 100.0, 0, pp_clock(), pp_clock())
  RETURNING id INTO v_ext;

  -- auto-extend-rentals' three rows: Extension Rental always, Tax and Service
  -- Fee when non-zero; due on the period's end, stamped with the extension.
  v_ref  := 'Payment plan renewal #' || v_seq || ': ';
  v_want := 1 + (CASE WHEN v_tax > 0 THEN 1 ELSE 0 END) + (CASE WHEN v_fee > 0 THEN 1 ELSE 0 END);
  INSERT INTO ledger_entries (rental_id, customer_id, vehicle_id, tenant_id, type, entry_date, due_date, extension_id,
                              category, reference, amount, remaining_amount)
  SELECT o.rental_id, v_rental.customer_id, v_rental.vehicle_id, o.tenant_id, 'Charge', v_today, o.period_end, v_ext,
         x.category, x.reference, x.cents / 100.0, x.cents / 100.0
    FROM (VALUES
            ('Extension Rental',      v_ref || v_days || 'd (' || to_char(o.period_start, 'YYYY-MM-DD') || ' → ' || to_char(o.period_end, 'YYYY-MM-DD') || ')', v_rent, true),
            ('Extension Tax',         v_ref || 'Tax',         v_tax, v_tax > 0),
            ('Extension Service Fee', v_ref || 'Service Fee', v_fee, v_fee > 0)
         ) AS x(category, reference, cents, wanted)
   WHERE x.wanted;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> v_want THEN
    RAISE EXCEPTION 'pp_post_renewal_period: % charge row(s) written for extension %, expected %', v_rows, v_ext, v_want;
  END IF;

  UPDATE payment_plan_occurrences
     SET extension_id = v_ext,
         amount = v_total / 100.0,
         insurance_status = CASE WHEN p_insurance_requested THEN 'pending' ELSE 'none' END
   WHERE id = o.id AND extension_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'pp_post_renewal_period: occurrence % was not posted', o.id;
  END IF;

  PERFORM pp__event(o.plan_id, o.id, 'period_posted', 'period_posted:' || o.id, v_total,
                    jsonb_build_object('extensionId', v_ext, 'sequenceNumber', v_seq,
                                       'periodStart', to_char(o.period_start, 'YYYY-MM-DD'),
                                       'periodEnd', to_char(o.period_end, 'YYYY-MM-DD'), 'days', v_days,
                                       'rentalCents', v_rent, 'taxCents', v_tax, 'serviceFeeCents', v_fee,
                                       'insuranceRequested', COALESCE(p_insurance_requested, false),
                                       'giveDaysNow', COALESCE(p_give_days_now, false)),
                    p_actor);

  IF p_give_days_now THEN
    v_moved := pp__extend_rental_end(o.rental_id, o.period_start, o.period_end);
    PERFORM pp__event(o.plan_id, o.id, 'rental_extended', 'rental_extended:given:' || o.id, NULL,
                      jsonb_build_object('extensionId', v_ext, 'via', 'give_days_now', 'endDateMoved', v_moved,
                                         'endDate', to_char(GREATEST(v_rental.end_date, o.period_end), 'YYYY-MM-DD')),
                      p_actor);
  END IF;

  RETURN jsonb_build_object('extensionId', v_ext, 'posted', true, 'sequenceNumber', v_seq, 'endDateMoved', v_moved);
END;
$$;


-- A4: the period's insurance decision. 'insured' (a policy was bought) adds
-- the Extension Insurance charge and raises the period's amount by the
-- premium; 'not_insurable' / 'failed' add NOTHING. Only while the period is
-- untouched (no attempt yet) — a premium is never added to a period that is
-- already being collected. A repeat of the same decision is a no-op.
CREATE OR REPLACE FUNCTION public.pp_record_renewal_insurance(p_occurrence_id uuid, p_decision jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  o          payment_plan_occurrences;
  pl         payment_plans;
  v_ext      rental_extensions;
  k          text;
  v_outcome  text;
  v_policy   uuid;
  v_premium  bigint;
  v_today    date;
  v_rows     integer;
BEGIN
  IF p_decision IS NULL OR jsonb_typeof(p_decision) <> 'object' THEN
    RAISE EXCEPTION 'pp_record_renewal_insurance: a decision is required' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_decision) LOOP
    IF k NOT IN ('outcome','policyRef','premiumCents','coveredFrom','coveredTo','reason') THEN
      RAISE EXCEPTION 'pp_record_renewal_insurance: unknown field "%"', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_outcome := p_decision->>'outcome';
  IF v_outcome IS NULL OR v_outcome NOT IN ('insured','not_insurable','failed') THEN
    RAISE EXCEPTION 'pp_record_renewal_insurance: outcome must be insured, not_insurable or failed (got %)', v_outcome
      USING ERRCODE = '22023';
  END IF;
  IF v_outcome = 'insured' THEN
    -- No premium without a policy: both are required, and the policy must be a real reference.
    v_policy  := NULLIF(p_decision->>'policyRef', '')::uuid;
    v_premium := (p_decision->>'premiumCents')::bigint;
    IF v_policy IS NULL OR v_premium IS NULL OR v_premium < 1 THEN
      RAISE EXCEPTION 'pp_record_renewal_insurance: an insured period needs a policy reference and a premium ≥ 1 cent'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO o FROM payment_plan_occurrences WHERE id = p_occurrence_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pp_record_renewal_insurance: occurrence % not found', p_occurrence_id USING ERRCODE = 'P0002';
  END IF;
  IF o.extension_id IS NULL THEN
    RAISE EXCEPTION 'pp_record_renewal_insurance: occurrence % is not a posted renewal period', p_occurrence_id
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_ext FROM rental_extensions WHERE id = o.extension_id FOR UPDATE;

  IF o.insurance_status <> 'pending' THEN
    IF o.insurance_status = v_outcome AND (v_outcome <> 'insured' OR v_ext.bonzah_policy_id = v_policy) THEN
      RETURN;   -- the same decision, delivered again
    END IF;
    RAISE EXCEPTION 'pp_record_renewal_insurance: insurance for occurrence % was already decided (%)', p_occurrence_id, o.insurance_status
      USING ERRCODE = '55000';
  END IF;
  IF o.attempt_no <> 0 OR o.status NOT IN ('scheduled','due') THEN
    RAISE EXCEPTION 'pp_record_renewal_insurance: occurrence % is already being collected; a premium can no longer be added', p_occurrence_id
      USING ERRCODE = '55000';
  END IF;

  IF v_outcome = 'insured' THEN
    SELECT * INTO pl FROM payment_plans WHERE id = o.plan_id;
    v_today := (pp_clock() AT TIME ZONE pl.timezone)::date;
    INSERT INTO ledger_entries (rental_id, customer_id, vehicle_id, tenant_id, type, entry_date, due_date, extension_id,
                                category, reference, amount, remaining_amount)
    SELECT r.id, r.customer_id, r.vehicle_id, o.tenant_id, 'Charge', v_today, o.period_end, o.extension_id,
           'Extension Insurance', 'Payment plan renewal #' || v_ext.sequence_number || ': Insurance',
           v_premium / 100.0, v_premium / 100.0
      FROM rentals r WHERE r.id = o.rental_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'pp_record_renewal_insurance: the insurance charge for occurrence % was not written', o.id;
    END IF;
    UPDATE rental_extensions
       SET insurance_amount = v_premium / 100.0, bonzah_policy_id = v_policy,
           bonzah_confirmed_at = pp_clock(), updated_at = pp_clock()
     WHERE id = o.extension_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'pp_record_renewal_insurance: extension % was not updated', o.extension_id;
    END IF;
    UPDATE payment_plan_occurrences
       SET amount = amount + v_premium / 100.0, insurance_status = 'insured'
     WHERE id = o.id AND insurance_status = 'pending';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'pp_record_renewal_insurance: occurrence % was not updated', o.id;
    END IF;
    PERFORM pp__event(o.plan_id, o.id, 'insurance_bought', 'insurance:' || o.id, v_premium,
                      jsonb_build_object('extensionId', o.extension_id, 'policyRef', v_policy,
                                         'coveredFrom', p_decision->>'coveredFrom', 'coveredTo', p_decision->>'coveredTo'),
                      NULL);
  ELSE
    UPDATE payment_plan_occurrences SET insurance_status = v_outcome
     WHERE id = o.id AND insurance_status = 'pending';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'pp_record_renewal_insurance: occurrence % was not updated', o.id;
    END IF;
    PERFORM pp__event(o.plan_id, o.id, 'insurance_not_bought', 'insurance:' || o.id, NULL,
                      jsonb_build_object('extensionId', o.extension_id, 'outcome', v_outcome,
                                         'reason', p_decision->>'reason'),
                      NULL);
  END IF;
END;
$$;


-- A renewal period whose extension's charges were settled OUTSIDE the plan
-- (an operator's payment on the rental, a generic checkout) is paid: settle
-- it, finalize its extension, move the end date. auto-extend's reconcile pass,
-- for plans. Never touches a period with a charge in flight or insurance
-- undecided, and never one the ledger zeroed without real money (a write-off
-- — that one is handled when it falls due). Returns the ids it settled.
CREATE OR REPLACE FUNCTION public.pp_reconcile_renewals(p_tenant uuid DEFAULT NULL, p_plan uuid DEFAULT NULL)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_id     uuid;
  v_status text;
BEGIN
  FOR v_id IN
    SELECT o.id
      FROM payment_plan_occurrences o
      JOIN payment_plans pl ON pl.id = o.plan_id
     WHERE pl.status = 'active'
       AND o.extension_id IS NOT NULL
       AND o.status IN ('scheduled','due','failed','requires_action','partially_paid')
       AND o.insurance_status <> 'pending'
       AND (p_tenant IS NULL OR o.tenant_id = p_tenant)
       AND (p_plan IS NULL OR o.plan_id = p_plan)
       AND NOT EXISTS (SELECT 1 FROM payment_plan_attempts a
                        WHERE a.occurrence_id = o.id AND a.status IN ('claimed','in_flight'))
       AND pp_extension_owed_cents(o.extension_id) = 0
       AND pp__extension_applied_cents(o.extension_id) >= round(o.amount * 100)::bigint
     ORDER BY o.due_at, o.seq
  LOOP
    v_status := pp__settle_renewal_period(v_id, 'ledger');
    IF v_status = 'paid' THEN
      RETURN NEXT v_id;
    END IF;
  END LOOP;
END;
$$;


-- The plans with renewal work (types.ts PlanRow each): every active renewal
-- plan, and any active plan holding an unposted or insurance-pending period.
CREATE OR REPLACE FUNCTION public.pp_list_renewal_plans(p_tenant uuid DEFAULT NULL, p_plan uuid DEFAULT NULL)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $$
  SELECT pp__plan_to_json(pl)
    FROM payment_plans pl
   WHERE pl.status = 'active'
     AND (p_tenant IS NULL OR pl.tenant_id = p_tenant)
     AND (p_plan IS NULL OR pl.id = p_plan)
     AND (pl.extends_rental
          OR EXISTS (SELECT 1 FROM payment_plan_occurrences o
                      WHERE o.plan_id = pl.id AND o.renews
                        AND o.status IN ('scheduled','due','failed','requires_action','partially_paid')
                        AND (o.extension_id IS NULL OR o.insurance_status = 'pending')))
   ORDER BY pl.created_at, pl.id
$$;


-- ─── Privileges: every pp_* function is service_role only ─────────────────
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
         'pp_trg_occurrence_guard','pp__plan_from_json','pp__plan_to_json','pp__insert_occurrences',
         'pp__maybe_complete_plan','pp_create_plan','pp_replace_future','pp_skip_occurrence',
         'pp_extension_owed_cents','pp__extension_applied_cents','pp_settle_occurrence',
         'pp__extend_rental_end','pp__finalize_extension_by_ledger','pp__settle_renewal_period',
         'pp_claim','pp_record_success','pp_append_renewal_period','pp_post_renewal_period',
         'pp_record_renewal_insurance','pp_reconcile_renewals','pp_list_renewal_plans'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END;
$$;
