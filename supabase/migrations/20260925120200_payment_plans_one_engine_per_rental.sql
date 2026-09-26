-- ============================================================================
-- Payment plans — ONE ENGINE PER RENTAL
-- docs/PAYMENT_PLANS_DESIGN.md (slice 1). Depends on
-- 20260925120100_payment_plans.sql.
--
-- NOT APPLIED. A file only. Applying it is a separate, explicit approval.
--
-- WHY
-- ---
-- A rental can still be on one of the billing mechanisms that predate payment
-- plans, each with its own cron that takes money:
--   auto_extend — rentals.auto_extend_enabled = true            (auto-extend-rentals)
--   payg        — rentals.is_pay_as_you_go = true AND payg_closed_at IS NULL
--                                                               (accrue-payg-charges)
--   installment — an installment_plans row whose status is pending, active or
--                 overdue                                        (the installment cron)
-- Nothing stopped a payment plan being set up on such a rental, so two crons
-- could charge the same rental for the same days. This migration makes the
-- two engines mutually exclusive per rental, in BOTH directions:
--
--   * a payment plan cannot be created on a rental that is on an old
--     mechanism — pp_create_plan's INSERT (and any other INSERT into
--     payment_plans) raises SQLSTATE P0001:
--       legacy_mechanism_active:<auto_extend|payg|installment>: <sentence>
--   * an old mechanism cannot be switched on while the rental has an active or
--     paused payment plan — the UPDATE / INSERT raises SQLSTATE P0001:
--       payment_plan_active: <sentence>
--
-- The sentences are the operator-facing text, word for word the constants in
-- supabase/functions/_shared/payment-plans/errors.ts (LEGACY_MECHANISM_REASON,
-- PAYMENT_PLAN_ACTIVE_REASON); a PGlite test pins that the two agree.
--
-- COST ON THE HOT TABLE
-- ---------------------
-- The rentals trigger is `BEFORE UPDATE OF <three columns>` with a WHEN clause
-- that is true only when a mechanism turns ON. Postgres evaluates WHEN without
-- calling the function, so every other UPDATE of rentals — including updates
-- that write these columns without switching anything on — pays nothing but
-- the comparison. The lookup it does make is an index probe
-- (ux_payment_plans_one_live_per_rental covers rental_id WHERE status IN
-- ('active','paused')).
--
-- RACES
-- -----
-- Both directions serialise on the RENTAL ROW LOCK:
--   * creating a plan takes it explicitly (pp__legacy_mechanism: SELECT … FOR
--     NO KEY UPDATE), and reads the flags from the locked, newest row version;
--   * an UPDATE of rentals holds it already (a BEFORE ROW trigger fires after
--     the executor has locked the row);
--   * an installment_plans INSERT/UPDATE takes it explicitly in its trigger.
-- Whoever is second waits for the first to commit, and — at READ COMMITTED,
-- the isolation PostgREST and the edge functions use — its next statement's
-- snapshot sees the first one's row and refuses. (At REPEATABLE READ or
-- SERIALIZABLE the second transaction's snapshot would predate the first's
-- commit; nothing in this codebase changes rentals at those levels.)
--
-- SECURITY DEFINER everywhere: the checks must see every plan and installment
-- row whatever the caller's RLS says. A customer-side or cross-tenant caller
-- whose RLS hides the plan would otherwise switch PAYG on straight past it.
--
-- NOT CHANGED: pp_resume_plan. A paused plan is already "live" for these
-- triggers, so no old mechanism can have been switched on while it was paused.
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- ============================================================================


-- ─── Which old mechanism is this rental on? (and take its row lock) ────────
-- NULL when none, or when the rental does not exist (pp_create_plan reports a
-- missing rental itself; the FK would refuse it anyway).
CREATE OR REPLACE FUNCTION public.pp__legacy_mechanism(p_rental_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_auto        boolean;
  v_payg        boolean;
  v_payg_closed timestamptz;
BEGIN
  -- FOR NO KEY UPDATE: the same lock an UPDATE of the rental takes, so a
  -- concurrent "switch auto-extend on" waits for this transaction, and this
  -- one reads the newest committed flags if it had to wait.
  SELECT auto_extend_enabled, is_pay_as_you_go, payg_closed_at
    INTO v_auto, v_payg, v_payg_closed
    FROM rentals
   WHERE id = p_rental_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_auto IS TRUE THEN
    RETURN 'auto_extend';
  END IF;
  IF v_payg IS TRUE AND v_payg_closed IS NULL THEN
    RETURN 'payg';
  END IF;
  IF EXISTS (SELECT 1 FROM installment_plans
              WHERE rental_id = p_rental_id
                AND status IN ('pending','active','overdue')) THEN
    RETURN 'installment';
  END IF;
  RETURN NULL;
END;
$$;


-- ─── A new live plan: refused while the rental is on an old mechanism ──────
CREATE OR REPLACE FUNCTION public.pp_trg_plan_one_engine()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_mech text;
BEGIN
  v_mech := pp__legacy_mechanism(NEW.rental_id);
  IF v_mech IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'legacy_mechanism_active:' || v_mech || ': ' || CASE v_mech
        WHEN 'auto_extend' THEN 'This rental renews automatically. Turn auto-extend off before setting up a payment plan.'
        WHEN 'payg'        THEN 'This rental is on pay-as-you-go. Close pay-as-you-go before setting up a payment plan.'
        ELSE                    'This rental has an installment plan. Cancel the installment plan before setting up a payment plan.'
      END,
      DETAIL = format('rental %s', NEW.rental_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pp_plan_one_engine ON public.payment_plans;
CREATE TRIGGER pp_plan_one_engine
  BEFORE INSERT ON public.payment_plans
  FOR EACH ROW
  WHEN (NEW.status IN ('active','paused'))
  EXECUTE FUNCTION public.pp_trg_plan_one_engine();


-- ─── auto-extend / PAYG switched ON: refused while a plan is live ──────────
CREATE OR REPLACE FUNCTION public.pp_trg_rental_one_engine()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_plan uuid;
BEGIN
  SELECT id INTO v_plan
    FROM payment_plans
   WHERE rental_id = NEW.id AND status IN ('active','paused')
   LIMIT 1;
  IF v_plan IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = 'payment_plan_active: ' || CASE
      WHEN NEW.auto_extend_enabled IS TRUE AND OLD.auto_extend_enabled IS NOT TRUE
        THEN 'This rental has a payment plan. Cancel the payment plan before turning on auto-extend.'
      ELSE 'This rental has a payment plan. Cancel the payment plan before turning on pay-as-you-go.'
    END,
    DETAIL = format('rental %s, payment plan %s', NEW.id, v_plan);
END;
$$;

DROP TRIGGER IF EXISTS pp_rental_one_engine ON public.rentals;
CREATE TRIGGER pp_rental_one_engine
  BEFORE UPDATE OF auto_extend_enabled, is_pay_as_you_go, payg_closed_at ON public.rentals
  FOR EACH ROW
  WHEN (
    (NEW.auto_extend_enabled IS TRUE AND OLD.auto_extend_enabled IS NOT TRUE)
    OR (NEW.is_pay_as_you_go IS TRUE AND NEW.payg_closed_at IS NULL
        AND NOT (OLD.is_pay_as_you_go IS TRUE AND OLD.payg_closed_at IS NULL))
  )
  EXECUTE FUNCTION public.pp_trg_rental_one_engine();


-- ─── An installment plan created or re-activated: refused while a plan is live
CREATE OR REPLACE FUNCTION public.pp_trg_installment_one_engine()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_plan uuid;
BEGIN
  -- The rental row lock pp__legacy_mechanism also takes: a plan being created
  -- for this rental right now finishes first, and is then seen below.
  PERFORM 1 FROM rentals WHERE id = NEW.rental_id FOR NO KEY UPDATE;
  SELECT id INTO v_plan
    FROM payment_plans
   WHERE rental_id = NEW.rental_id AND status IN ('active','paused')
   LIMIT 1;
  IF v_plan IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'payment_plan_active: This rental has a payment plan. Cancel the payment plan before setting up an installment plan.',
      DETAIL = format('rental %s, payment plan %s', NEW.rental_id, v_plan);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pp_installment_one_engine_insert ON public.installment_plans;
CREATE TRIGGER pp_installment_one_engine_insert
  BEFORE INSERT ON public.installment_plans
  FOR EACH ROW
  WHEN (NEW.status IN ('pending','active','overdue'))
  EXECUTE FUNCTION public.pp_trg_installment_one_engine();

DROP TRIGGER IF EXISTS pp_installment_one_engine_update ON public.installment_plans;
CREATE TRIGGER pp_installment_one_engine_update
  BEFORE UPDATE OF status, rental_id ON public.installment_plans
  FOR EACH ROW
  WHEN (NEW.status IN ('pending','active','overdue')
        AND (OLD.status NOT IN ('pending','active','overdue') OR OLD.rental_id IS DISTINCT FROM NEW.rental_id))
  EXECUTE FUNCTION public.pp_trg_installment_one_engine();


-- ─── Privileges: service_role only, like every pp_* function ───────────────
-- (A trigger function runs for whoever fires the trigger whatever its ACL —
-- EXECUTE is checked when the trigger is created — so this closes the direct
-- call path and changes nothing for the triggers.)
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
         'pp__legacy_mechanism','pp_trg_plan_one_engine','pp_trg_rental_one_engine',
         'pp_trg_installment_one_engine'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END;
$$;
