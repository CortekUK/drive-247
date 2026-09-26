-- ============================================================================
-- dev_sim_runs — evidence tables and fixture guards for the E2E live runner
-- docs/E2E_TESTING.md · supabase/functions/e2e-runner · tests/e2e/
--
-- NOT APPLIED. A file only. Applying it is a separate, explicit approval.
-- Depends on 20260925120100_payment_plans.sql (payment_plan_occurrences /
-- payment_plan_attempts, which e2e_shift_fixture backdates for plan fixtures).
--
-- WHAT IS HERE
-- ------------
--   dev_sim_runs         one row per scenario run: who started it, which
--                        scenario (and the scenario definition as it was at
--                        run time, so a result can always be re-read against
--                        what was expected), status, fixture ids, pass/fail.
--   dev_sim_run_steps    one row per executed step: what was done, what the
--                        edge function answered, the rows observed, and every
--                        assertion's expected / actual / pass.
--   dev_sim_fixtures     THE FIXTURE MARKER. A rental is an E2E fixture if and
--                        only if it has a row here. Only e2e_register_fixture
--                        can write one, and it refuses any rental that is not
--                        brand new, marked, northwind's, on a fixture customer
--                        and free of money.
--   e2e_fixture_guard    the authoritative per-request check (below).
--   e2e_register_fixture the only door into dev_sim_fixtures.
--   e2e_shift_fixture    sim_shift-style backdating of ONE fixture's driving
--                        columns. sim_shift itself stays staging-only (its
--                        sim_meta sentinel is untouched); this is the
--                        northwind-in-production counterpart with its own,
--                        stricter guards.
--   e2e_lease_run        one runner request per run at a time.
--
-- GUARDS ENFORCED IN SQL (the edge function checks the same things first; these
-- hold even if the function were wrong)
-- ---------------------------------------------------------------------------
--   * tenant: slug = 'northwind' AND stripe_mode = 'test' AND status = 'active',
--     re-read on EVERY call — flipping northwind to live stops the runner mid-run.
--   * fixture: registered in dev_sim_fixtures for THIS run; the rental's
--     creation_context says e2e_fixture = true for this run; its customer is
--     named 'E2E-FIXTURE…', has an @e2e.drive247.test address and no phone.
--   * shift: a closed domain → table/column allow-list; |shift| ≤ 60 days;
--     date columns move in whole days only; zero rows moved is an error.
--   * writes: service_role only. Staff can READ their own tenant's runs.
--
-- RLS: SELECT for authenticated where tenant_id = get_user_tenant_id() or
-- is_super_admin(); no INSERT/UPDATE/DELETE policy at all, and the table
-- privileges are REVOKEd from anon and authenticated as well (Supabase's
-- default privileges would otherwise GRANT them).
-- ============================================================================


-- ─── Tables ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dev_sim_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  scenario_id        text NOT NULL CHECK (length(btrim(scenario_id)) > 0),
  -- The scenario exactly as the catalogue said it at run time.
  scenario           jsonb NOT NULL,
  status             text NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running','waiting','passed','failed','errored','aborted')),
  next_step          integer NOT NULL DEFAULT 0 CHECK (next_step >= 0),
  -- A human step the run is waiting on: { stepIndex, ask, say, url }.
  waiting_for        jsonb,
  -- rental_id, customer_id, stripe ids, plan_id, original_end_date, shifts.
  fixture            jsonb NOT NULL DEFAULT '{}'::jsonb,
  pass_count         integer NOT NULL DEFAULT 0 CHECK (pass_count >= 0),
  fail_count         integer NOT NULL DEFAULT 0 CHECK (fail_count >= 0),
  error              text,
  created_by         uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  lease_token        uuid,
  lease_until        timestamptz,
  fixture_parked     boolean NOT NULL DEFAULT true,
  fixture_closed_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  CONSTRAINT dev_sim_runs_finished_when_terminal
    CHECK ((status IN ('passed','failed','errored','aborted')) = (finished_at IS NOT NULL)),
  CONSTRAINT dev_sim_runs_waiting_has_ask
    CHECK ((status = 'waiting') = (waiting_for IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_dev_sim_runs_tenant_created
  ON public.dev_sim_runs (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.dev_sim_run_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES public.dev_sim_runs(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  step_index    integer NOT NULL CHECK (step_index >= -1),   -- -1 = the fixture
  kind          text NOT NULL,
  label         text,
  status        text NOT NULL CHECK (status IN ('ok','failed','error','refused')),
  request       jsonb,
  response      jsonb,
  observed      jsonb,
  assertions    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(assertions) = 'array'),
  pass_count    integer NOT NULL DEFAULT 0 CHECK (pass_count >= 0),
  fail_count    integer NOT NULL DEFAULT 0 CHECK (fail_count >= 0),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dev_sim_run_steps_once UNIQUE (run_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_dev_sim_run_steps_run
  ON public.dev_sim_run_steps (run_id, step_index);

CREATE TABLE IF NOT EXISTS public.dev_sim_fixtures (
  rental_id    uuid PRIMARY KEY REFERENCES public.rentals(id) ON DELETE CASCADE,
  run_id       uuid NOT NULL UNIQUE REFERENCES public.dev_sim_runs(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- A fixture marker never changes: no UPDATE, ever (DELETE cascades with its run).
CREATE OR REPLACE FUNCTION public.dev_sim_fixtures_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'dev_sim_fixtures rows are immutable' USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS dev_sim_fixtures_no_update ON public.dev_sim_fixtures;
CREATE TRIGGER dev_sim_fixtures_no_update
  BEFORE UPDATE ON public.dev_sim_fixtures
  FOR EACH ROW EXECUTE FUNCTION public.dev_sim_fixtures_immutable();

CREATE OR REPLACE FUNCTION public.dev_sim_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dev_sim_runs_touch ON public.dev_sim_runs;
CREATE TRIGGER dev_sim_runs_touch
  BEFORE UPDATE ON public.dev_sim_runs
  FOR EACH ROW EXECUTE FUNCTION public.dev_sim_touch_updated_at();


-- ─── The authoritative guard ───────────────────────────────────────────────

-- Raises unless p_run_id is a live run on northwind in Stripe TEST mode whose
-- registered fixture is still a fixture. Returns that fixture's rental id.
CREATE OR REPLACE FUNCTION public.e2e_fixture_guard(p_run_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_run      public.dev_sim_runs%ROWTYPE;
  v_tenant   record;
  v_fix      public.dev_sim_fixtures%ROWTYPE;
  v_rental   record;
  v_customer record;
BEGIN
  SELECT * INTO v_run FROM dev_sim_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'e2e: run % not found', p_run_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_run.status NOT IN ('running','waiting') THEN
    RAISE EXCEPTION 'e2e: run % is %, not running', p_run_id, v_run.status USING ERRCODE = 'check_violation';
  END IF;

  SELECT slug, stripe_mode, status INTO v_tenant FROM tenants WHERE id = v_run.tenant_id;
  IF v_tenant.slug IS DISTINCT FROM 'northwind' THEN
    RAISE EXCEPTION 'e2e: refused — the run''s tenant is not northwind' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_tenant.stripe_mode IS DISTINCT FROM 'test' THEN
    RAISE EXCEPTION 'e2e: refused — northwind is not in Stripe TEST mode' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_tenant.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'e2e: refused — northwind is not active' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_fix FROM dev_sim_fixtures WHERE run_id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'e2e: run % has no registered fixture', p_run_id USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, tenant_id, customer_id, creation_context INTO v_rental FROM rentals WHERE id = v_fix.rental_id;
  IF NOT FOUND OR v_rental.tenant_id IS DISTINCT FROM v_run.tenant_id
     OR v_rental.customer_id IS DISTINCT FROM v_fix.customer_id
     OR COALESCE(v_rental.creation_context->>'e2e_fixture', '') <> 'true'
     OR COALESCE(v_rental.creation_context->>'run_id', '') <> p_run_id::text THEN
    RAISE EXCEPTION 'e2e: refused — rental % is not this run''s fixture', v_fix.rental_id USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT name, email, phone INTO v_customer FROM customers WHERE id = v_fix.customer_id;
  IF NOT FOUND OR COALESCE(v_customer.name, '') NOT LIKE 'E2E-FIXTURE%'
     OR COALESCE(v_customer.email, '') NOT LIKE '%@e2e.drive247.test'
     OR v_customer.phone IS NOT NULL THEN
    RAISE EXCEPTION 'e2e: refused — the fixture customer is not a fixture customer' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN v_fix.rental_id;
END;
$$;


-- ─── The only door into dev_sim_fixtures ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.e2e_register_fixture(p_run_id uuid, p_rental_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_run      public.dev_sim_runs%ROWTYPE;
  v_tenant   record;
  v_rental   record;
  v_customer record;
  v_rows     integer;
BEGIN
  SELECT * INTO v_run FROM dev_sim_runs WHERE id = p_run_id;
  IF NOT FOUND OR v_run.status <> 'running' THEN
    RAISE EXCEPTION 'e2e_register_fixture: run % is not running', p_run_id USING ERRCODE = 'check_violation';
  END IF;

  SELECT slug, stripe_mode, status INTO v_tenant FROM tenants WHERE id = v_run.tenant_id;
  IF v_tenant.slug IS DISTINCT FROM 'northwind' OR v_tenant.stripe_mode IS DISTINCT FROM 'test'
     OR v_tenant.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'e2e_register_fixture: refused — only northwind in Stripe TEST mode' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id, tenant_id, customer_id, creation_context, created_at INTO v_rental FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'e2e_register_fixture: rental % not found', p_rental_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_rental.tenant_id IS DISTINCT FROM v_run.tenant_id THEN
    RAISE EXCEPTION 'e2e_register_fixture: refused — rental is not northwind''s' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(v_rental.creation_context->>'e2e_fixture', '') <> 'true'
     OR COALESCE(v_rental.creation_context->>'run_id', '') <> p_run_id::text THEN
    RAISE EXCEPTION 'e2e_register_fixture: refused — rental is not marked as this run''s fixture' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Brand new only: an existing rental can never be turned into a fixture.
  IF v_rental.created_at < now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'e2e_register_fixture: refused — rental is older than 10 minutes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Free of money: a rental that has taken a payment is never a fixture.
  IF EXISTS (SELECT 1 FROM payments WHERE rental_id = p_rental_id) THEN
    RAISE EXCEPTION 'e2e_register_fixture: refused — rental already has payments' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT name, email, phone INTO v_customer FROM customers WHERE id = v_rental.customer_id;
  IF NOT FOUND OR COALESCE(v_customer.name, '') NOT LIKE 'E2E-FIXTURE%'
     OR COALESCE(v_customer.email, '') NOT LIKE '%@e2e.drive247.test'
     OR v_customer.phone IS NOT NULL THEN
    RAISE EXCEPTION 'e2e_register_fixture: refused — the customer is not a fixture customer' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO dev_sim_fixtures (rental_id, run_id, tenant_id, customer_id)
  VALUES (p_rental_id, p_run_id, v_run.tenant_id, v_rental.customer_id);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'e2e_register_fixture: expected 1 row, wrote %', v_rows;
  END IF;
END;
$$;


-- ─── sim_shift for ONE fixture ─────────────────────────────────────────────

-- Positive p_minutes = time passes: every driving column of the domain moves
-- that far into the PAST (sim_shift's convention). Returns rows moved.
--
--   payg          rentals: payg_next_accrual_at, payg_start_ts,
--                 payg_last_accrual_at, payg_last_reminder_sent_at, start_date
--   auto_extend   rentals: auto_extend_next_charge_at, end_date,
--                 auto_extend_last_charge_at, auto_extend_last_reminder_at;
--                 its rental_extensions: created_at, requested_at, approved_at
--                 (the pay-link grace is measured from when the customer was
--                 asked); its auto_extension_reminders: sent_at
--   installment   scheduled_installments: due_date;
--                 installment_plans: last_reminder_sent_at, next_due_date
--   payment_plan  payment_plan_occurrences: due_at, due_date, next_attempt_at
--   plan_attempts payment_plan_attempts still unresolved (claimed / in_flight
--                 / indeterminate): created_at — minutes allowed, so recovery's
--                 600-second stale window can be crossed
--
-- These are the same columns as sim-control's sim-shift-manifest.json for the
-- rentals domains (tests/e2e/runner-guards.test.ts keeps the two in step).
CREATE OR REPLACE FUNCTION public.e2e_shift_fixture(p_run_id uuid, p_domain text, p_minutes integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_rental uuid;
  v_by     interval;
  v_days   integer;
  v_rows   integer := 0;
  v_n      integer;
BEGIN
  v_rental := public.e2e_fixture_guard(p_run_id);

  IF p_minutes IS NULL OR p_minutes = 0 OR abs(p_minutes) > 60 * 24 * 60 THEN
    RAISE EXCEPTION 'e2e_shift_fixture: p_minutes % out of bounds (non-zero, at most 60 days)', p_minutes USING ERRCODE = '22023';
  END IF;
  IF p_domain IS DISTINCT FROM 'plan_attempts' AND p_minutes % 1440 <> 0 THEN
    RAISE EXCEPTION 'e2e_shift_fixture: domain % has date columns and moves in whole days only', p_domain USING ERRCODE = '22023';
  END IF;
  v_by := make_interval(mins => p_minutes);
  v_days := p_minutes / 1440;

  IF p_domain = 'payg' THEN
    UPDATE rentals
       SET payg_next_accrual_at       = payg_next_accrual_at - v_by,
           payg_start_ts              = payg_start_ts - v_by,
           payg_last_accrual_at       = payg_last_accrual_at - v_by,
           payg_last_reminder_sent_at = payg_last_reminder_sent_at - v_by,
           start_date                 = start_date - v_days
     WHERE id = v_rental;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

  ELSIF p_domain = 'auto_extend' THEN
    UPDATE rentals
       SET auto_extend_next_charge_at   = auto_extend_next_charge_at - v_by,
           end_date                     = end_date - v_days,
           auto_extend_last_charge_at   = auto_extend_last_charge_at - v_by,
           auto_extend_last_reminder_at = auto_extend_last_reminder_at - v_by
     WHERE id = v_rental;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    UPDATE rental_extensions
       SET created_at   = created_at - v_by,
           requested_at = requested_at - v_by,
           approved_at  = approved_at - v_by
     WHERE rental_id = v_rental;
    IF to_regclass('public.auto_extension_reminders') IS NOT NULL THEN
      EXECUTE 'UPDATE public.auto_extension_reminders SET sent_at = sent_at - $1
                WHERE extension_id IN (SELECT id FROM public.rental_extensions WHERE rental_id = $2)'
        USING v_by, v_rental;
    END IF;

  ELSIF p_domain = 'installment' THEN
    UPDATE scheduled_installments SET due_date = due_date - v_days WHERE rental_id = v_rental;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    UPDATE installment_plans
       SET last_reminder_sent_at = last_reminder_sent_at - v_by,
           next_due_date         = next_due_date - v_days
     WHERE rental_id = v_rental;

  ELSIF p_domain = 'payment_plan' THEN
    UPDATE payment_plan_occurrences
       SET due_at          = due_at - v_by,
           due_date        = due_date - v_days,
           next_attempt_at = next_attempt_at - v_by
     WHERE rental_id = v_rental;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

  ELSIF p_domain = 'plan_attempts' THEN
    UPDATE payment_plan_attempts a
       SET created_at = a.created_at - v_by
      FROM payment_plan_occurrences o
     WHERE o.id = a.occurrence_id
       AND o.rental_id = v_rental
       AND a.status IN ('claimed','in_flight','indeterminate');
    GET DIAGNOSTICS v_rows = ROW_COUNT;

  ELSE
    RAISE EXCEPTION 'e2e_shift_fixture: domain % is not allow-listed', p_domain USING ERRCODE = '22023';
  END IF;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'e2e_shift_fixture: % moved no rows for fixture rental %', p_domain, v_rental USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_rows;
END;
$$;


-- ─── One runner request per run ────────────────────────────────────────────

-- TRUE when this caller now holds the run for p_seconds; FALSE when another
-- request holds it. Released by writing lease_until = NULL with the same token.
CREATE OR REPLACE FUNCTION public.e2e_lease_run(p_run_id uuid, p_token uuid, p_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_seconds IS NULL OR p_seconds < 1 OR p_seconds > 900 THEN
    RAISE EXCEPTION 'e2e_lease_run: p_seconds % out of bounds (1..900)', p_seconds USING ERRCODE = '22023';
  END IF;
  UPDATE dev_sim_runs
     SET lease_token = p_token,
         lease_until = now() + make_interval(secs => p_seconds)
   WHERE id = p_run_id
     AND status IN ('running','waiting')
     AND (lease_until IS NULL OR lease_until < now() OR lease_token = p_token);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;


-- ─── RLS: staff read their tenant; nobody but service_role writes ─────────

ALTER TABLE public.dev_sim_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_sim_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_sim_fixtures  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dev_sim_runs_staff_read ON public.dev_sim_runs;
CREATE POLICY dev_sim_runs_staff_read ON public.dev_sim_runs
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS dev_sim_run_steps_staff_read ON public.dev_sim_run_steps;
CREATE POLICY dev_sim_run_steps_staff_read ON public.dev_sim_run_steps
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS dev_sim_fixtures_staff_read ON public.dev_sim_fixtures;
CREATE POLICY dev_sim_fixtures_staff_read ON public.dev_sim_fixtures
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- Supabase's default privileges grant ALL on new tables to anon and
-- authenticated. RLS already stops writes (no policy); this makes it two walls.
REVOKE ALL ON public.dev_sim_runs, public.dev_sim_run_steps, public.dev_sim_fixtures FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.dev_sim_runs, public.dev_sim_run_steps, public.dev_sim_fixtures FROM authenticated;
GRANT SELECT ON public.dev_sim_runs, public.dev_sim_run_steps, public.dev_sim_fixtures TO authenticated;
GRANT ALL ON public.dev_sim_runs, public.dev_sim_run_steps, public.dev_sim_fixtures TO service_role;

-- Functions: service_role only (default privileges would grant EXECUTE to all).
REVOKE ALL ON FUNCTION public.e2e_fixture_guard(uuid)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.e2e_register_fixture(uuid, uuid)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.e2e_shift_fixture(uuid, text, integer)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.e2e_lease_run(uuid, uuid, integer)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dev_sim_fixtures_immutable()                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dev_sim_touch_updated_at()                  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e2e_fixture_guard(uuid)                  TO service_role;
GRANT EXECUTE ON FUNCTION public.e2e_register_fixture(uuid, uuid)         TO service_role;
GRANT EXECUTE ON FUNCTION public.e2e_shift_fixture(uuid, text, integer)   TO service_role;
GRANT EXECUTE ON FUNCTION public.e2e_lease_run(uuid, uuid, integer)       TO service_role;
