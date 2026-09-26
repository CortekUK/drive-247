-- @pglite-harness
-- ============================================================================
-- Balance adjustments — "how much does this customer owe me", moved both ways
-- (Wave 1 of docs/PAYMENTS_ROADMAP.md, spec §8, assumption A1)
--
-- NOT APPLIED. A file only. Applying it is a separate, explicit approval.
--
-- WHAT IT ADDS
-- ------------
-- One "Adjust balance" panel asks "What happened?" and records one of three
-- different things. Each is a real row in the ledger or in payments, never a
-- display-only number, and each is written with an audit row saying WHO, WHEN
-- and WHY in the new append-only table `balance_adjustments`:
--
--   charge_correction    "A charge was wrong" — a signed Adjustment charge
--                        (negative = credit, positive = debit) against ONE
--                        specific charge, carrying that charge's rental and
--                        extension. Also used, with reason 'payment_request'
--                        and no target, for "Request a payment": a new charge
--                        whose reference is what the payment is for.
--   off_platform_payment "I received money outside the platform" — a REAL
--                        payments row (is_off_platform = true), written by the
--                        portal's existing Record Payment path (client insert +
--                        apply-payment) and applied by the normal allocator
--                        exactly like cash. This migration only adds the flag
--                        and the function that records its audit row.
--   goodwill             "Goodwill / agreed reduction" — a negative Adjustment
--                        charge on a rental or on the customer account.
--
-- Undo is ALWAYS a new, reversing entry (`reverses_id`), never a delete or an
-- edit: a correction or goodwill is undone by an equal and opposite Adjustment
-- charge; an off-platform payment is undone by the existing `reverse-payment`
-- function (status 'Reversed', allocations restored) and then recorded here.
--
-- WHY A NEGATIVE ADJUSTMENT MOVES THE BALANCE
-- -------------------------------------------
-- The balance is Σ Charge.remaining_amount (lib/finances/balance.ts). An
-- Adjustment row is written with remaining_amount = amount, so a −30.00 row
-- lowers the balance by exactly 30.00. The allocator only touches rows with
-- remaining_amount > 0, so a credit is never "paid". Charges on PAYG,
-- cancelled or rejected rentals do NOT count toward the balance, so an
-- adjustment scoped to one of those rentals would change nothing the operator
-- can see — balance_adjust refuses it and says to use the account instead.
--
-- DEPENDENCY
-- ----------
-- A POSITIVE Adjustment (a debit, or a payment request) can only be settled by
-- a payment once 20260925120000_ledger_allocation_prerequisites.sql is live:
-- the live payment_apply_fifo_v2 INNER JOINs a hard-coded category list with
-- no 'Adjustment' in it. Apply that migration first (or together, before this
-- one). Section 0 refuses to run otherwise.
--
-- APPEND-ONLY
-- -----------
-- * Every write goes through one of three SECURITY DEFINER functions,
--   EXECUTE-able by service_role only (the adjust-customer-balance edge
--   function). Each writes its ledger row and its audit row in ONE transaction
--   and asserts both row counts.
-- * No API role (anon, authenticated, service_role) holds INSERT, UPDATE,
--   DELETE or TRUNCATE on the table. Staff get SELECT through RLS.
-- * A trigger refuses every UPDATE and every direct DELETE/TRUNCATE, even by
--   the table owner. A delete CASCADED from its customer or tenant is allowed
--   (the audit dies with the account it describes, like its ledger rows) — so
--   deleting a customer or a tenant is never blocked by this table.
-- * rental_id, extension_id, ledger_entry_id, payment_id and target_charge_id
--   are evidence pointers with NO foreign key: an audit row never blocks, and
--   is never rewritten by, a delete of the money row it describes.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- DROP … IF EXISTS before each constraint/trigger/policy, CREATE OR REPLACE for
-- every function.
-- ============================================================================


-- ─── 0. Order guard: the allocation prerequisites must already be live ──────
-- Applied on its own, this migration would let an operator raise a positive
-- Adjustment (a debit, a payment request) that the LIVE allocator can never
-- settle. ledger_settleable_categories() is created by
-- 20260925120000_ledger_allocation_prerequisites.sql together with the
-- allocator that settles 'Adjustment', so it is the proof that file is live.
-- Two statements, not one condition: PL/pgSQL plans each statement when it
-- first runs, so the call below is never planned when the function is absent.
DO $$
BEGIN
  IF to_regprocedure('public.ledger_settleable_categories()') IS NULL THEN
    RAISE EXCEPTION 'Apply 20260925120000_ledger_allocation_prerequisites.sql first: ledger_settleable_categories() does not exist, so the live allocator cannot settle an Adjustment.'
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT ('Adjustment' = ANY (COALESCE(public.ledger_settleable_categories(), ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'Apply 20260925120000_ledger_allocation_prerequisites.sql first: ledger_settleable_categories() does not list Adjustment, so the allocator cannot settle one.'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;


-- ─── 1. payments.is_off_platform ────────────────────────────────────────────

-- Money that really changed hands outside the platform (cash in hand, a bank
-- transfer, Zelle). It is revenue like any recorded payment and is applied by
-- the same allocator; the flag only (a) labels it "Off-platform" and (b) keeps
-- it out of any Stripe/Square reconciliation wording. Constant default, so on
-- PG 11+ this is a metadata-only change: no table rewrite.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS is_off_platform boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payments.is_off_platform IS
  'Money received outside the platform (cash, bank transfer, Zelle, check). Counts as a payment like cash; never carries a processor handle; excluded from provider reconciliation.';

-- An off-platform payment has, by definition, no processor record. Enforced so
-- nothing can later attach a Stripe/Square handle to one and make the
-- reconciliation screens show a provider link for money no provider saw.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_off_platform_no_processor_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_off_platform_no_processor_check CHECK (
  NOT is_off_platform
  OR (payment_type = 'Payment'
      AND stripe_payment_intent_id IS NULL AND stripe_checkout_session_id IS NULL AND stripe_refund_id IS NULL
      AND square_payment_id IS NULL AND square_order_id IS NULL AND square_refund_id IS NULL
      AND square_payment_link_id IS NULL)
);


-- ─── 2. balance_adjustments ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.balance_adjustments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id      uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  -- Evidence pointers — deliberately no FK (see the header).
  rental_id        uuid,
  extension_id     uuid,
  kind             text NOT NULL,
  -- Signed effect on what the customer owes: positive = owes more, negative =
  -- owes less. An off-platform payment of 100.00 is −100.00; its undo +100.00.
  amount           numeric(12,2) NOT NULL,
  reason_code      text NOT NULL,
  note             text NOT NULL,
  ledger_entry_id  uuid,
  payment_id       uuid,
  -- charge_correction only: the charge this corrects (NULL for a payment request).
  target_charge_id uuid,
  reverses_id      uuid REFERENCES public.balance_adjustments(id) ON DELETE CASCADE,
  created_by       uuid NOT NULL REFERENCES public.app_users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.balance_adjustments DROP CONSTRAINT IF EXISTS balance_adjustments_kind_check;
ALTER TABLE public.balance_adjustments ADD CONSTRAINT balance_adjustments_kind_check
  CHECK (kind IN ('charge_correction', 'off_platform_payment', 'goodwill'));
ALTER TABLE public.balance_adjustments DROP CONSTRAINT IF EXISTS balance_adjustments_amount_check;
ALTER TABLE public.balance_adjustments ADD CONSTRAINT balance_adjustments_amount_check
  CHECK (amount <> 0);
ALTER TABLE public.balance_adjustments DROP CONSTRAINT IF EXISTS balance_adjustments_reason_code_check;
ALTER TABLE public.balance_adjustments ADD CONSTRAINT balance_adjustments_reason_code_check
  CHECK (reason_code ~ '^[a-z][a-z_]{1,39}$');
ALTER TABLE public.balance_adjustments DROP CONSTRAINT IF EXISTS balance_adjustments_note_check;
ALTER TABLE public.balance_adjustments ADD CONSTRAINT balance_adjustments_note_check
  CHECK (length(btrim(note)) BETWEEN 1 AND 1000);
ALTER TABLE public.balance_adjustments DROP CONSTRAINT IF EXISTS balance_adjustments_self_reversal_check;
ALTER TABLE public.balance_adjustments ADD CONSTRAINT balance_adjustments_self_reversal_check
  CHECK (reverses_id IS NULL OR reverses_id <> id);
-- What each kind stands on: a payment, or a ledger row — never both, never neither.
ALTER TABLE public.balance_adjustments DROP CONSTRAINT IF EXISTS balance_adjustments_evidence_check;
ALTER TABLE public.balance_adjustments ADD CONSTRAINT balance_adjustments_evidence_check CHECK (
  (kind = 'off_platform_payment' AND payment_id IS NOT NULL AND ledger_entry_id IS NULL AND target_charge_id IS NULL)
  OR (kind <> 'off_platform_payment' AND ledger_entry_id IS NOT NULL AND payment_id IS NULL)
);
-- Goodwill and a payment only ever LOWER what is owed; only their undo raises it.
ALTER TABLE public.balance_adjustments DROP CONSTRAINT IF EXISTS balance_adjustments_direction_check;
ALTER TABLE public.balance_adjustments ADD CONSTRAINT balance_adjustments_direction_check CHECK (
  kind = 'charge_correction' OR reverses_id IS NOT NULL OR amount < 0
);
ALTER TABLE public.balance_adjustments DROP CONSTRAINT IF EXISTS balance_adjustments_target_check;
ALTER TABLE public.balance_adjustments ADD CONSTRAINT balance_adjustments_target_check CHECK (
  target_charge_id IS NULL OR kind = 'charge_correction'
);

-- One undo per entry, and one record per off-platform payment.
CREATE UNIQUE INDEX IF NOT EXISTS ux_balance_adjustments_one_undo
  ON public.balance_adjustments (reverses_id) WHERE reverses_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_balance_adjustments_one_record_per_payment
  ON public.balance_adjustments (payment_id) WHERE kind = 'off_platform_payment' AND reverses_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_balance_adjustments_customer
  ON public.balance_adjustments (tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_adjustments_rental
  ON public.balance_adjustments (rental_id, created_at DESC) WHERE rental_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_balance_adjustments_target
  ON public.balance_adjustments (target_charge_id) WHERE target_charge_id IS NOT NULL;

COMMENT ON TABLE public.balance_adjustments IS
  'Append-only audit of every manual balance change (who, when, why). Written only by balance_adjust / balance_record_off_platform_payment / balance_adjustment_reverse. Undo = a reversing row (reverses_id), never a delete.';

-- Append-only, for everyone including the owner. A DELETE fired by a cascade
-- from customers/tenants runs at trigger depth 2 and is let through.
CREATE OR REPLACE FUNCTION public.balance_adjustments_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'balance_adjustments is append-only: % is not allowed — undo an entry by recording its reversal', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS balance_adjustments_append_only_row ON public.balance_adjustments;
CREATE TRIGGER balance_adjustments_append_only_row
  BEFORE UPDATE OR DELETE ON public.balance_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.balance_adjustments_append_only();

DROP TRIGGER IF EXISTS balance_adjustments_append_only_truncate ON public.balance_adjustments;
CREATE TRIGGER balance_adjustments_append_only_truncate
  BEFORE TRUNCATE ON public.balance_adjustments
  FOR EACH STATEMENT EXECUTE FUNCTION public.balance_adjustments_append_only();

-- RLS: tenant staff read their own tenant's rows; super admins read all.
ALTER TABLE public.balance_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS balance_adjustments_staff_select ON public.balance_adjustments;
CREATE POLICY balance_adjustments_staff_select ON public.balance_adjustments
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_user_tenant_id()) OR (SELECT public.is_super_admin()));

-- Supabase's default privileges grant ALL on a new table to every API role.
-- Take all of it back, then give back SELECT only. No API role can write.
REVOKE ALL ON public.balance_adjustments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.balance_adjustments TO authenticated, service_role;


-- ─── 3. Reason codes — the one list ─────────────────────────────────────────
-- The portal's labels (components/balance/balance-words.ts) are pinned to this
-- list by a test that reads this file.

CREATE OR REPLACE FUNCTION public.balance_reason_codes(p_kind text, p_is_undo boolean DEFAULT false)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $$
  SELECT CASE
    WHEN p_is_undo THEN ARRAY['entered_by_mistake','wrong_amount','wrong_customer','customer_disputed','other']
    WHEN p_kind = 'charge_correction' THEN ARRAY['overcharged','undercharged','wrong_rate','duplicate_charge','payment_request','other']
    WHEN p_kind = 'off_platform_payment' THEN ARRAY['paid_in_person','paid_by_transfer','settled_elsewhere','other']
    WHEN p_kind = 'goodwill' THEN ARRAY['goodwill','late_delivery','vehicle_problem','loyalty','agreed_discount','other']
    ELSE ARRAY[]::text[]
  END
$$;


-- ─── 4. Internal checks ─────────────────────────────────────────────────────
-- Messages raised with ERRCODE P0001 are written for the operator: the edge
-- function returns them verbatim (400). 42501 = not allowed (403), P0002 = not
-- found (404), 23505 = already done (409).

-- The person making the change: an active staff member of this tenant (or a
-- super admin), and not a read-only viewer.
CREATE OR REPLACE FUNCTION public.balance__assert_actor(p_tenant_id uuid, p_created_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  u record;
BEGIN
  SELECT id, tenant_id, role, is_active, COALESCE(is_super_admin, false) AS super_admin
    INTO u FROM app_users WHERE id = p_created_by;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a member of staff can change a balance.' USING ERRCODE = '42501';
  END IF;
  IF NOT u.is_active THEN
    RAISE EXCEPTION 'This staff account is deactivated.' USING ERRCODE = '42501';
  END IF;
  IF NOT (u.super_admin OR u.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'This staff account belongs to a different business.' USING ERRCODE = '42501';
  END IF;
  IF u.role = 'viewer' THEN
    RAISE EXCEPTION 'Read-only accounts cannot change a balance.' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.balance__assert_customer(p_tenant_id uuid, p_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM customers WHERE id = p_customer_id;
  IF NOT FOUND OR v_tenant IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'Customer not found for this tenant' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- A rental an adjustment may be scoped to. Returns its vehicle. Refuses a
-- rental whose charges the balance does not count (PAYG, cancelled, rejected):
-- the adjustment would be invisible there.
CREATE OR REPLACE FUNCTION public.balance__assert_rental(p_tenant_id uuid, p_customer_id uuid, p_rental_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  SELECT id, tenant_id, customer_id, vehicle_id, status, approval_status, is_pay_as_you_go
    INTO r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND OR r.tenant_id IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'That rental was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF r.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'That rental belongs to a different customer.' USING ERRCODE = '42501';
  END IF;
  IF r.status = 'Cancelled' OR r.approval_status = 'rejected' THEN
    RAISE EXCEPTION 'This rental is cancelled, so its charges no longer count toward the balance. Adjust the customer account instead.';
  END IF;
  IF r.is_pay_as_you_go IS TRUE THEN
    RAISE EXCEPTION 'This rental is billed day by day, so its balance comes from the daily bills. Adjust the customer account instead.';
  END IF;
  RETURN r.vehicle_id;
END;
$$;

-- "Today" on the tenant's own calendar (tenants.timezone), never UTC.
CREATE OR REPLACE FUNCTION public.balance__tenant_today(p_tenant_id uuid)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_zone text;
BEGIN
  SELECT NULLIF(btrim(timezone), '') INTO v_zone FROM tenants WHERE id = p_tenant_id;
  BEGIN
    RETURN (now() AT TIME ZONE COALESCE(v_zone, 'America/New_York'))::date;
  EXCEPTION WHEN OTHERS THEN
    RETURN (now() AT TIME ZONE 'America/New_York')::date;
  END;
END;
$$;

-- The note, validated once.
CREATE OR REPLACE FUNCTION public.balance__clean_note(p_note text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path = public
AS $$
DECLARE
  v text := btrim(COALESCE(p_note, ''));
BEGIN
  IF v = '' THEN
    RAISE EXCEPTION 'Say why: a note is required.';
  END IF;
  IF length(v) > 1000 THEN
    RAISE EXCEPTION 'Keep the note under 1,000 characters.';
  END IF;
  RETURN v;
END;
$$;

-- The short tag every adjustment's ledger reference ends with. It keeps two
-- same-day adjustments with the same words on the same rental distinct under
-- ux_rental_charge_unique, and ties the ledger row back to its audit row.
CREATE OR REPLACE FUNCTION public.balance__tag(p_id uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $$ SELECT 'ADJ-' || left(replace(p_id::text, '-', ''), 8) $$;

-- Net correction already standing against a charge (entries not undone).
CREATE OR REPLACE FUNCTION public.balance__net_correction(p_charge_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $$
  SELECT COALESCE(sum(a.amount), 0)
    FROM balance_adjustments a
   WHERE a.target_charge_id = p_charge_id
     AND a.reverses_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM balance_adjustments u WHERE u.reverses_id = a.id)
$$;


-- ─── 5. balance_adjust — (a) a charge was wrong, (c) goodwill ───────────────
-- p_amount is SIGNED dollars (negative = credit). Writes one Adjustment charge
-- and one audit row, in this transaction, and asserts both.

CREATE OR REPLACE FUNCTION public.balance_adjust(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_created_by uuid,
  p_kind text,
  p_amount numeric,
  p_reason_code text,
  p_note text,
  p_rental_id uuid DEFAULT NULL,
  p_extension_id uuid DEFAULT NULL,
  p_target_charge_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_note text;
  v_rental uuid := p_rental_id;
  v_extension uuid := p_extension_id;
  v_vehicle uuid;
  v_rental_vehicle uuid;
  t record;
  v_net numeric;
  v_today date;
  v_entry uuid;
  v_rows integer;
BEGIN
  PERFORM balance__assert_actor(p_tenant_id, p_created_by);
  PERFORM balance__assert_customer(p_tenant_id, p_customer_id);

  IF p_kind IS NULL OR p_kind NOT IN ('charge_correction', 'goodwill') THEN
    RAISE EXCEPTION 'balance_adjust: kind must be charge_correction or goodwill (got %)', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'Enter an amount that is not zero.';
  END IF;
  IF p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Amounts have at most two decimal places.';
  END IF;
  v_note := balance__clean_note(p_note);
  IF p_reason_code IS NULL OR NOT (p_reason_code = ANY (balance_reason_codes(p_kind, false))) THEN
    RAISE EXCEPTION 'Pick a reason from the list.';
  END IF;

  IF p_kind = 'goodwill' THEN
    IF p_amount > 0 THEN
      RAISE EXCEPTION 'Goodwill can only lower what the customer owes.';
    END IF;
    IF p_target_charge_id IS NOT NULL THEN
      RAISE EXCEPTION 'Goodwill is not against one charge. To fix a charge, choose "A charge was wrong".';
    END IF;
  ELSE
    IF p_reason_code IN ('overcharged', 'duplicate_charge') AND p_amount > 0 THEN
      RAISE EXCEPTION 'An overcharge is corrected with a credit, not a further charge.';
    END IF;
    IF p_reason_code IN ('undercharged', 'payment_request') AND p_amount < 0 THEN
      RAISE EXCEPTION 'An undercharge is corrected with an extra charge, not a credit.';
    END IF;
    IF p_reason_code = 'payment_request' AND p_target_charge_id IS NOT NULL THEN
      RAISE EXCEPTION 'A payment request is a new charge, not a change to an existing one.';
    END IF;
    IF p_reason_code <> 'payment_request' AND p_target_charge_id IS NULL THEN
      RAISE EXCEPTION 'Pick the charge that was wrong.';
    END IF;
  END IF;

  IF p_target_charge_id IS NOT NULL THEN
    -- Locked, so two corrections of the same charge cannot both pass the cap.
    SELECT id, tenant_id, customer_id, rental_id, extension_id, vehicle_id, type, category, amount
      INTO t FROM ledger_entries WHERE id = p_target_charge_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That charge no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    IF t.tenant_id IS DISTINCT FROM p_tenant_id OR t.customer_id IS DISTINCT FROM p_customer_id THEN
      RAISE EXCEPTION 'That charge is not on this customer''s account.' USING ERRCODE = '42501';
    END IF;
    IF t.type <> 'Charge' OR t.amount <= 0 THEN
      RAISE EXCEPTION 'Only a charge can be corrected.';
    END IF;
    IF t.category = 'Security Deposit' THEN
      RAISE EXCEPTION 'The deposit is changed from the deposit panel, not here.';
    END IF;
    IF p_rental_id IS NOT NULL AND p_rental_id IS DISTINCT FROM t.rental_id THEN
      RAISE EXCEPTION 'That charge is on a different rental.';
    END IF;
    IF p_extension_id IS NOT NULL AND p_extension_id IS DISTINCT FROM t.extension_id THEN
      RAISE EXCEPTION 'That charge is on a different extension.';
    END IF;
    v_rental := t.rental_id;
    v_extension := t.extension_id;
    v_vehicle := t.vehicle_id;
    -- A credit may take a charge down to zero, never below it.
    v_net := balance__net_correction(p_target_charge_id);
    IF t.amount + v_net + p_amount < 0 THEN
      RAISE EXCEPTION 'That is more than the charge: at most % can be credited against it.',
        to_char(t.amount + v_net, 'FM999999990.00');
    END IF;
  END IF;

  IF v_extension IS NOT NULL AND v_rental IS NULL THEN
    RAISE EXCEPTION 'An extension belongs to a rental: say which rental.';
  END IF;
  IF v_rental IS NOT NULL THEN
    v_rental_vehicle := balance__assert_rental(p_tenant_id, p_customer_id, v_rental);
    v_vehicle := COALESCE(v_vehicle, v_rental_vehicle);
    IF v_extension IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM rental_extensions WHERE id = v_extension AND rental_id = v_rental
    ) THEN
      RAISE EXCEPTION 'That extension is not on this rental.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  v_today := balance__tenant_today(p_tenant_id);

  INSERT INTO ledger_entries (customer_id, tenant_id, rental_id, vehicle_id, extension_id, type, category,
                              amount, remaining_amount, entry_date, due_date, reference)
  VALUES (p_customer_id, p_tenant_id, v_rental, v_vehicle, v_extension, 'Charge', 'Adjustment',
          p_amount, p_amount, v_today, v_today, left(v_note, 400) || ' · ' || balance__tag(v_id))
  RETURNING id INTO v_entry;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 OR v_entry IS NULL THEN
    RAISE EXCEPTION 'balance_adjust: expected to write 1 ledger row, wrote %', v_rows USING ERRCODE = 'XX000';
  END IF;

  INSERT INTO balance_adjustments (id, tenant_id, customer_id, rental_id, extension_id, kind, amount, reason_code, note,
                                   ledger_entry_id, payment_id, target_charge_id, reverses_id, created_by)
  VALUES (v_id, p_tenant_id, p_customer_id, v_rental, v_extension, p_kind, p_amount, p_reason_code, v_note,
          v_entry, NULL, p_target_charge_id, NULL, p_created_by);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'balance_adjust: expected to write 1 audit row, wrote %', v_rows USING ERRCODE = 'XX000';
  END IF;

  RETURN jsonb_build_object(
    'adjustment_id', v_id, 'ledger_entry_id', v_entry, 'kind', p_kind, 'amount', p_amount,
    'rental_id', v_rental, 'extension_id', v_extension, 'reference', left(v_note, 400) || ' · ' || balance__tag(v_id));
END;
$$;


-- ─── 6. balance_record_off_platform_payment — (b) the audit row ─────────────
-- The payment itself is written by the portal's existing Record Payment path
-- with is_off_platform = true, and applied by apply-payment / the FIFO trigger
-- exactly like cash. This records WHO / WHY against it, once.

CREATE OR REPLACE FUNCTION public.balance_record_off_platform_payment(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_created_by uuid,
  p_payment_id uuid,
  p_reason_code text,
  p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_note text;
  p record;
  v_rows integer;
BEGIN
  PERFORM balance__assert_actor(p_tenant_id, p_created_by);
  PERFORM balance__assert_customer(p_tenant_id, p_customer_id);
  v_note := balance__clean_note(p_note);
  IF p_reason_code IS NULL OR NOT (p_reason_code = ANY (balance_reason_codes('off_platform_payment', false))) THEN
    RAISE EXCEPTION 'Pick a reason from the list.';
  END IF;

  SELECT id, tenant_id, customer_id, rental_id, extension_id, amount, status, payment_type, is_off_platform
    INTO p FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That payment was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF p.tenant_id IS DISTINCT FROM p_tenant_id OR p.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'That payment is not on this customer''s account.' USING ERRCODE = '42501';
  END IF;
  IF NOT p.is_off_platform THEN
    RAISE EXCEPTION 'That payment was not recorded as received outside the platform.';
  END IF;
  IF p.payment_type <> 'Payment' OR p.amount <= 0 THEN
    RAISE EXCEPTION 'Only a payment received can be recorded here.';
  END IF;
  IF p.status IN ('Reversed', 'Refunded', 'Pending') THEN
    RAISE EXCEPTION 'That payment has been undone or is not settled, so it is not money received.';
  END IF;
  IF EXISTS (SELECT 1 FROM balance_adjustments
              WHERE payment_id = p_payment_id AND kind = 'off_platform_payment' AND reverses_id IS NULL) THEN
    RAISE EXCEPTION 'This payment is already on the record.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO balance_adjustments (id, tenant_id, customer_id, rental_id, extension_id, kind, amount, reason_code, note,
                                   ledger_entry_id, payment_id, target_charge_id, reverses_id, created_by)
  VALUES (v_id, p_tenant_id, p_customer_id, p.rental_id, p.extension_id, 'off_platform_payment', -p.amount,
          p_reason_code, v_note, NULL, p_payment_id, NULL, NULL, p_created_by);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'balance_record_off_platform_payment: expected to write 1 audit row, wrote %', v_rows USING ERRCODE = 'XX000';
  END IF;

  RETURN jsonb_build_object(
    'adjustment_id', v_id, 'payment_id', p_payment_id, 'kind', 'off_platform_payment', 'amount', -p.amount,
    'rental_id', p.rental_id, 'extension_id', p.extension_id);
END;
$$;


-- ─── 7. balance_adjustment_reverse — Undo, as a new entry ───────────────────

CREATE OR REPLACE FUNCTION public.balance_adjustment_reverse(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_created_by uuid,
  p_adjustment_id uuid,
  p_reason_code text,
  p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_note text;
  o record;
  t record;
  p record;
  v_vehicle uuid;
  v_entry uuid;
  v_rows integer;
  v_today date;
BEGIN
  PERFORM balance__assert_actor(p_tenant_id, p_created_by);
  PERFORM balance__assert_customer(p_tenant_id, p_customer_id);
  v_note := balance__clean_note(p_note);
  IF p_reason_code IS NULL OR NOT (p_reason_code = ANY (balance_reason_codes(NULL, true))) THEN
    RAISE EXCEPTION 'Pick a reason from the list.';
  END IF;

  SELECT * INTO o FROM balance_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That entry was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF o.tenant_id IS DISTINCT FROM p_tenant_id OR o.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'That entry is not on this customer''s account.' USING ERRCODE = '42501';
  END IF;
  IF o.reverses_id IS NOT NULL THEN
    RAISE EXCEPTION 'This entry is itself an undo. Record a new adjustment instead.';
  END IF;
  IF EXISTS (SELECT 1 FROM balance_adjustments WHERE reverses_id = o.id) THEN
    RAISE EXCEPTION 'This entry has already been undone.' USING ERRCODE = '23505';
  END IF;

  IF o.kind = 'off_platform_payment' THEN
    -- The money is taken back by reverse-payment (status 'Reversed', its
    -- allocations restored) BEFORE this runs. A payment that has since been
    -- deleted outright is gone from the balance too.
    SELECT status, COALESCE(refund_amount, 0) AS refunded INTO p FROM payments WHERE id = o.payment_id FOR UPDATE;
    -- Refunded, in part or in full: some of this money has already gone back
    -- to the customer. Undoing the whole entry would count that part twice
    -- (once refunded, once reversed), so it is refused — whatever the status
    -- says now, since a refunded payment can later be marked Reversed.
    IF FOUND AND (p.refunded > 0 OR p.status IN ('Refunded', 'Partial Refund')) THEN
      RAISE EXCEPTION 'This payment has been refunded, in part or in full, so it cannot be undone. Record a correction for what is still wrong instead.';
    END IF;
    IF FOUND AND p.status IS DISTINCT FROM 'Reversed' THEN
      RAISE EXCEPTION 'Reverse the payment first: it still counts as money received.';
    END IF;
  ELSE
    -- Undoing an entry that RAISED what is owed (a debit correction, a payment
    -- request) once a payment has been applied to it would strand that
    -- payment: its allocation stays on the original row while the undo writes
    -- a credit for the full amount. So an undo is only for an entry nobody has
    -- paid against. Locked, so a payment cannot land between check and write.
    IF o.amount > 0 THEN
      SELECT amount, remaining_amount INTO t FROM ledger_entries WHERE id = o.ledger_entry_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The charge this entry added no longer exists, so there is nothing to undo.';
      END IF;
      IF t.remaining_amount < o.amount THEN
        RAISE EXCEPTION 'Part of this has been paid — record a correction instead.';
      END IF;
    END IF;
    -- Undoing a DEBIT correction must not leave the credits against the same
    -- charge larger than the charge.
    IF o.target_charge_id IS NOT NULL AND o.amount > 0 THEN
      SELECT amount INTO t FROM ledger_entries WHERE id = o.target_charge_id FOR UPDATE;
      IF FOUND AND t.amount + balance__net_correction(o.target_charge_id) - o.amount < 0 THEN
        RAISE EXCEPTION 'Undo the later credit against this charge first.';
      END IF;
    END IF;
    SELECT vehicle_id INTO v_vehicle FROM ledger_entries WHERE id = o.ledger_entry_id;
    v_today := balance__tenant_today(p_tenant_id);
    INSERT INTO ledger_entries (customer_id, tenant_id, rental_id, vehicle_id, extension_id, type, category,
                                amount, remaining_amount, entry_date, due_date, reference)
    VALUES (o.customer_id, o.tenant_id, o.rental_id, v_vehicle, o.extension_id, 'Charge', 'Adjustment',
            -o.amount, -o.amount, v_today, v_today,
            'Undo of ' || balance__tag(o.id) || ': ' || left(v_note, 380) || ' · ' || balance__tag(v_id))
    RETURNING id INTO v_entry;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 OR v_entry IS NULL THEN
      RAISE EXCEPTION 'balance_adjustment_reverse: expected to write 1 ledger row, wrote %', v_rows USING ERRCODE = 'XX000';
    END IF;
  END IF;

  INSERT INTO balance_adjustments (id, tenant_id, customer_id, rental_id, extension_id, kind, amount, reason_code, note,
                                   ledger_entry_id, payment_id, target_charge_id, reverses_id, created_by)
  VALUES (v_id, o.tenant_id, o.customer_id, o.rental_id, o.extension_id, o.kind, -o.amount, p_reason_code, v_note,
          v_entry, CASE WHEN o.kind = 'off_platform_payment' THEN o.payment_id END, o.target_charge_id, o.id, p_created_by);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'balance_adjustment_reverse: expected to write 1 audit row, wrote %', v_rows USING ERRCODE = 'XX000';
  END IF;

  RETURN jsonb_build_object(
    'adjustment_id', v_id, 'reverses_id', o.id, 'ledger_entry_id', v_entry, 'kind', o.kind, 'amount', -o.amount,
    'payment_id', CASE WHEN o.kind = 'off_platform_payment' THEN o.payment_id END);
END;
$$;


-- ─── 8. Privileges: service_role only ───────────────────────────────────────

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
         'balance_adjustments_append_only', 'balance_reason_codes', 'balance__assert_actor',
         'balance__assert_customer', 'balance__assert_rental', 'balance__tenant_today', 'balance__clean_note',
         'balance__tag', 'balance__net_correction', 'balance_adjust', 'balance_record_off_platform_payment',
         'balance_adjustment_reverse'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END;
$$;
