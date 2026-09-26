-- @pglite-harness
-- ============================================================================
-- Payment reallocation and bill reconciliation (Wave 2 — spec §5.3)
-- docs/PAYMENTS_ROADMAP.md Wave 2: "Reallocate a payment … as one atomic SQL
-- function with an audit trail (who, why, before, after) — never a silent
-- delete", and "Reconcile this bill … shows the gap and offers the fixes".
--
-- NOT APPLIED. A file only. Applying it is a separate, explicit approval.
-- Depends on 20260925120000_ledger_allocation_prerequisites.sql
-- (v_ledger_allocation_drift; the FIFO's P&L category mapping, mirrored here).
--
-- WHAT THIS ADDS
-- --------------
--   payment_allocation_changes      append-only audit (who, why, before, after)
--   payment_reallocate(...)         move a payment's money between charges
--   charge_recompute_remaining(...) remaining_amount := amount − Σ applications
--                                   for ONE drifted charge
--   bill_reconcile_options(...)     read-only: why a bill does not tie out and
--                                   the exact operations that would close it
-- The three entry points and every helper that reads a table are SECURITY
-- DEFINER; every function has search_path pinned and EXECUTE for service_role
-- only (the payment-reallocate edge function authorises the operator first).
-- tests/payment-plans/reallocation/ is the evidence for everything below.
--
-- UNITS
-- -----
-- Money columns are numeric(12,2) dollars, like the ledger. Every parameter and
-- jsonb key that carries money is INTEGER CENTS and says so (`amount_cents`,
-- `applied_cents` …) — the convention of 20260925120100_payment_plans.sql. A
-- target written with the shorthand `amount` is refused ("unknown field"), not
-- silently read as dollars or cents.
--
-- HOW A REALLOCATION WRITES (payment_reallocate)
-- ----------------------------------------------
-- p_targets is the payment's COMPLETE new allocation:
--   [{"charge_entry_id": uuid, "amount_cents": integer > 0}, …]
-- A charge the payment covers today and that the list omits is un-applied; an
-- empty list un-applies everything (the payment becomes unused credit).
--
-- The function works charge by charge on the difference between what the
-- payment has on a charge now (old) and what the list asks for (new):
--   ledger_entries.remaining_amount   −= (new − old)            (relative write)
--   payment_applications              the (payment, charge) row becomes `new`
--                                     (deleted at 0, inserted when new)
--   pnl_entries                       the (payment, charge) Revenue row, keyed
--                                     exactly as the live FIFO keys it —
--                                     source_ref = payment_id || '_' || charge_id
--                                     (unique: ux_pnl_source_reference) — is
--                                     made to equal `new`: deleted at 0, inserted
--                                     with the FIFO's own values when missing.
-- On a (payment, charge) pair the FIFO wrote, the P&L row equals the
-- application, so "made to equal new" is exactly "subtract what the FIFO booked
-- for the old amount, book what the FIFO would book for the new one". On a pair
-- where they already disagreed (history: the pre-20260925 ON CONFLICT DO
-- NOTHING, or apply-payment's fee path that books no P&L) the row is brought
-- back to the allocation and the audit row carries both numbers. Charges whose
-- amount does not change are not written at all.
--
-- What the FIFO would book (payment_apply_fifo_v2, live body in
-- 20260925120000): side 'Revenue', entry_date = the charge's due_date, category
-- mapped by pal__pnl_category() (Fine → Fines, InitialFee → Initial Fees,
-- Extension Add-on → Extras, anything the pnl_entries category CHECK does not allow →
-- Other), amount, source_ref; tenant = the payment's; vehicle = the payment's.
-- NEVER a Security Deposit (a liability, not revenue — the FIFO's own guard).
-- Two deliberate differences, both where the FIFO has no precedent:
--   * money moved onto ANOTHER rental's charge is booked to that charge's
--     vehicle (revenue follows the car that earned it); on the payment's own
--     rental the payment's vehicle is used, as the FIFO does (charge's when the
--     payment has none);
--   * a charge without a due_date books on its entry_date (the FIFO would fail
--     the pnl_entries NOT NULL and abort).
--
-- Validation, all before the first write:
--   * the payment is CAPTURED money: status Applied / Credit / Partial /
--     Partial Refund and capture_status NULL or 'captured' (requires_capture,
--     cancelled and expired hold no money — the CAPTURED rule of
--     use-customer-balance.ts); 'Completed' (FIFO still running), 'Pending',
--     'Reversed' and 'Refunded' are refused, each with its own sentence;
--   * the operator (p_actor) is an active app user of the payment's company, or
--     a super admin;
--   * every target is a Charge of the SAME customer and company, amount > 0,
--     listed once;
--   * Σ targets ≤ the payment's net amount (amount − refund_amount): refunded
--     money cannot pay a charge;
--   * a charge may go UP only into what it still owes
--     (remaining_amount − (new − old) ≥ 0 — "no target exceeds that charge's
--     remaining after un-applying") and may always go DOWN, except that it can
--     never re-open past its own amount (remaining_amount + (old − new) ≤
--     amount). The second can only trip on a charge whose records already
--     disagree; bill_reconcile_options gives the order that avoids it.
--
-- Payment status afterwards (net = amount − refund_amount, placed = Σ targets):
--   'Partial Refund'                      stays 'Partial Refund' (the refund
--                                         state is what other code keys on);
--                                         remaining_amount = net − placed
--   no refund, placed = 0                 'Credit',  remaining_amount = net
--   no refund, placed = net               'Applied', remaining_amount = 0
--   no refund, otherwise                  'Partial', remaining_amount = net − placed
--   refund recorded but status not a      'Applied' only when placed = net;
--   refund status (an inconsistent row)   otherwise refused (refund_status_mismatch):
--                                         as 'Credit'/'Partial' the FIFO, which
--                                         ignores refund_amount, would later
--                                         place the refunded money as well.
-- status is written only when it changes (on_payment_received_notify and
-- friends fire on UPDATE OF status).
--
-- A payment carrying target_categories (the live
-- enforce_payment_target_categories trigger refuses an application outside the
-- list) has the list WIDENED by the categories of the new targets; the audit's
-- before/after show both lists.
--
-- Locks: the payment row FOR UPDATE first, then every charge the call touches
-- (old ∪ new) FOR UPDATE in id order, then the payment's application rows.
-- While the payment row is locked, no other transaction can insert an
-- application for it (the payment_id FK check needs FOR KEY SHARE on it).
-- Every money write asserts it touched exactly one row and RAISEs otherwise —
-- the whole call then rolls back. (The one unasserted write is the fines
-- status sync below: 0 rows there just means the fine was not 'Paid'.)
--
-- KNOWN LIMITS (reported, not silently handled)
-- ---------------------------------------------
-- * payment_apply_fifo_v2 reads a payment without locking it. A FIFO run on the
--   SAME payment that read its applications before this call committed can
--   still add to them afterwards (the pre-existing FIFO-vs-FIFO race). The fix
--   is one line in payment_apply_fifo_v2 (lock the payment row first), which
--   this migration does not own.
-- * A re-opened charge is not re-opened in payg_accruals / scheduled_installments
--   / rental_extensions status (those record history; the ledger is what the
--   balance reads). The one inverse this migration does apply is for fines: the
--   live trigger sync_fine_status_on_charge_settled marks a FINE-<uuid> fine
--   'Paid' when its charge drains; when these functions re-open that charge,
--   the fine goes back from 'Paid' to 'Charged'.
--
-- THE AUDIT (payment_allocation_changes)
-- --------------------------------------
-- One table for both kinds of change (kind = 'reallocate' | 'recompute_remaining')
-- so a bill's reconciliation history is one timeline with one shape. A
-- recompute row has payment_id NULL and charge_entry_id set; a reallocation row
-- the reverse (CHECK). payment_id / charge_entry_id / customer_id carry NO
-- foreign key on purpose: an append-only record must outlive what it describes,
-- and an FK would either delete the history (CASCADE), blank it (SET NULL) or
-- block the payment deletes undo-manual-payment performs today (NO ACTION).
-- tenant_id cascades with the tenant; created_by is SET NULL with the user, and
-- created_by_label keeps the operator's name/email as it was, so "who" survives
-- a deleted account.
-- Append-only, the same way as balance_adjustments (20260926120000): no API
-- role (not even service_role) holds INSERT, UPDATE, DELETE or TRUNCATE, and a
-- trigger refuses every UPDATE / DELETE / TRUNCATE even by the owner — except
-- the two referential actions above, which run at trigger depth > 1 (a DELETE
-- cascaded from the tenant; an UPDATE that only blanks created_by). Rows are
-- written only by the SECURITY DEFINER functions below. Staff SELECT their own
-- company's rows (RLS).
--
-- Error contract: every refusal is RAISEd as '<code>: <sentence for the
-- operator>'. invalid_input → 22023, not_found → P0002, forbidden → 42501,
-- everything else → P0001. The edge function maps the code prefix to HTTP.
-- ============================================================================


-- ─── The audit table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_allocation_changes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('reallocate', 'recompute_remaining')),
  payment_id       uuid,
  charge_entry_id  uuid,
  customer_id      uuid,
  rental_ids       uuid[] NOT NULL DEFAULT '{}',
  reason           text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 200),
  note             text CHECK (note IS NULL OR length(note) <= 2000),
  before           jsonb NOT NULL,
  after            jsonb NOT NULL,
  created_by       uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_by_label text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_allocation_changes_subject_check CHECK (
       (kind = 'reallocate'          AND payment_id IS NOT NULL AND charge_entry_id IS NULL)
    OR (kind = 'recompute_remaining' AND payment_id IS NULL     AND charge_entry_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ix_payment_allocation_changes_tenant_created
  ON public.payment_allocation_changes (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_payment_allocation_changes_payment
  ON public.payment_allocation_changes (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_payment_allocation_changes_charge
  ON public.payment_allocation_changes (charge_entry_id) WHERE charge_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_payment_allocation_changes_rentals
  ON public.payment_allocation_changes USING gin (rental_ids);

COMMENT ON TABLE public.payment_allocation_changes IS
  'Append-only audit of manual reconciliation: payment reallocations and charge remaining_amount recomputes. Written only by payment_reallocate / charge_recompute_remaining. Amounts in *_cents are integer cents.';

-- Append-only, for everyone including the owner. The only writes let through
-- are the referential actions, which run at trigger depth > 1: the DELETE
-- cascaded from tenants, and the UPDATE of ON DELETE SET NULL on created_by
-- (allowed only when nothing but created_by changes, and only to NULL).
CREATE OR REPLACE FUNCTION public.payment_allocation_changes_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.created_by IS NULL
       AND (to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'payment_allocation_changes is append-only: % is not allowed — a change is undone by another reallocation, which is audited too', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS payment_allocation_changes_append_only_row ON public.payment_allocation_changes;
CREATE TRIGGER payment_allocation_changes_append_only_row
  BEFORE UPDATE OR DELETE ON public.payment_allocation_changes
  FOR EACH ROW EXECUTE FUNCTION public.payment_allocation_changes_append_only();

DROP TRIGGER IF EXISTS payment_allocation_changes_append_only_truncate ON public.payment_allocation_changes;
CREATE TRIGGER payment_allocation_changes_append_only_truncate
  BEFORE TRUNCATE ON public.payment_allocation_changes
  FOR EACH STATEMENT EXECUTE FUNCTION public.payment_allocation_changes_append_only();

ALTER TABLE public.payment_allocation_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_allocation_changes_staff_select ON public.payment_allocation_changes;
CREATE POLICY payment_allocation_changes_staff_select ON public.payment_allocation_changes
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_user_tenant_id()) OR (SELECT public.is_super_admin()));

-- Supabase's default privileges grant ALL on new tables to anon, authenticated
-- and service_role. Take all of it back, then give reads only.
REVOKE ALL ON public.payment_allocation_changes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.payment_allocation_changes TO authenticated, service_role;


-- ─── Internal helpers ───────────────────────────────────────────────────────

-- The live FIFO's ledger → P&L category mapping (payment_apply_fifo_v2,
-- 20260925120000 CHANGES §2), as one function. KEEP-IN-SYNC with that body and
-- with the pnl_entries category CHECK; tests/payment-plans/reallocation/ compares this
-- against what the FIFO actually books for every ledger category.
CREATE OR REPLACE FUNCTION public.pal__pnl_category(p_ledger_category text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public, pg_temp
AS $$
  SELECT CASE
           WHEN m IS NULL OR NOT (m = ANY (ARRAY[
             'Initial Fees', 'Rental', 'Acquisition', 'Finance', 'Service',
             'Fines', 'Other', 'Disposal', 'Plates', 'Insurance', 'Delivery Fee',
             'Collection Fee', 'Extras', 'Security Deposit', 'Extension',
             'Extension Rental', 'Extension Tax', 'Extension Service Fee',
             'Extension Insurance', 'Excess Mileage', 'Unlimited Mileage', 'Tax',
             'Service Fee', 'Expenses'
           ]::text[])) THEN 'Other'
           ELSE m
         END
    FROM (SELECT CASE p_ledger_category
                   WHEN 'Fine'             THEN 'Fines'
                   WHEN 'InitialFee'       THEN 'Initial Fees'
                   WHEN 'Extension Add-on' THEN 'Extras'
                   ELSE p_ledger_category
                 END AS m) x
$$;


CREATE OR REPLACE FUNCTION public.pal__money(p numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public, pg_temp
AS $$ SELECT to_char(COALESCE(p, 0), 'FM999999999990.00') $$;


-- The operator behind a change: an active app user of this company, or a super
-- admin. The edge function has already checked the role; this is the database's
-- own copy of the tenant rule, so a service-role caller cannot write another
-- company's audit under someone's name.
CREATE OR REPLACE FUNCTION public.pal__assert_actor(p_actor uuid, p_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $$
DECLARE
  u app_users;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'forbidden: say who is making this change (an app user is required)' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO u FROM app_users WHERE id = p_actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden: app user % not found', p_actor USING ERRCODE = '42501';
  END IF;
  IF u.is_active IS FALSE THEN
    RAISE EXCEPTION 'forbidden: this account is deactivated' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(u.is_super_admin, false) AND u.tenant_id IS DISTINCT FROM p_tenant THEN
    RAISE EXCEPTION 'forbidden: this operator does not belong to the company this money belongs to' USING ERRCODE = '42501';
  END IF;
END;
$$;


-- "Who", as it read when the change was made (survives a deleted account).
CREATE OR REPLACE FUNCTION public.pal__actor_label(p_actor uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(NULLIF(btrim(u.name), '') || ' <' || u.email || '>', u.email)
    FROM app_users u WHERE u.id = p_actor
$$;


CREATE OR REPLACE FUNCTION public.pal__require_reason(p_reason text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path = public, pg_temp
AS $$
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'invalid_input: say why (a reason is required)' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'invalid_input: the reason is longer than 200 characters — put the detail in the note' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 2000 THEN
    RAISE EXCEPTION 'invalid_input: the note is longer than 2000 characters' USING ERRCODE = '22023';
  END IF;
END;
$$;


-- Inverse of the live sync_fine_status_on_charge_settled for the one case these
-- functions create: a FINE-<uuid> charge re-opened from ≤ 0 to > 0. Status
-- sync, not a money write, so a fine that is not 'Paid' is simply left alone.
CREATE OR REPLACE FUNCTION public.pal__reopen_fine(p_reference text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_reference LIKE 'FINE-%'
     AND substring(p_reference from 6) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    UPDATE fines SET status = 'Charged'
     WHERE id = substring(p_reference from 6)::uuid
       AND status = 'Paid';
  END IF;
END;
$$;


-- One payment's allocation and the charges a change touches, in cents.
CREATE OR REPLACE FUNCTION public.pal__payment_snapshot(p_payment_id uuid, p_charge_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'payment', jsonb_build_object(
      'id',                p.id,
      'status',            p.status,
      'rental_id',         p.rental_id,
      'customer_id',       p.customer_id,
      'amount_cents',      round(p.amount * 100)::bigint,
      'refund_cents',      round(COALESCE(p.refund_amount, 0) * 100)::bigint,
      'net_cents',         round((p.amount - COALESCE(p.refund_amount, 0)) * 100)::bigint,
      'remaining_cents',   round(COALESCE(p.remaining_amount, 0) * 100)::bigint,
      'target_categories', p.target_categories),
    'placed_cents', (SELECT round(COALESCE(sum(pa.amount_applied), 0) * 100)::bigint
                       FROM payment_applications pa WHERE pa.payment_id = p.id),
    'applications', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'charge_entry_id', pa.charge_entry_id,
               'category',        le.category,
               'rental_id',       le.rental_id,
               'due_date',        le.due_date,
               'applied_cents',   round(pa.amount_applied * 100)::bigint,
               'pnl_cents',       (SELECT round(sum(pe.amount) * 100)::bigint FROM pnl_entries pe
                                    WHERE pe.source_ref = p.id::text || '_' || pa.charge_entry_id::text))
             ORDER BY le.due_date NULLS LAST, le.category, pa.charge_entry_id)
        FROM payment_applications pa
        LEFT JOIN ledger_entries le ON le.id = pa.charge_entry_id
       WHERE pa.payment_id = p.id), '[]'::jsonb),
    'charges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'charge_entry_id', le.id,
               'category',        le.category,
               'rental_id',       le.rental_id,
               'extension_id',    le.extension_id,
               'due_date',        le.due_date,
               'reference',       le.reference,
               'amount_cents',    round(le.amount * 100)::bigint,
               'remaining_cents', round(le.remaining_amount * 100)::bigint)
             ORDER BY le.due_date NULLS LAST, le.category, le.id)
        FROM ledger_entries le
       WHERE le.id = ANY (p_charge_ids)), '[]'::jsonb))
  FROM payments p
 WHERE p.id = p_payment_id
$$;


-- One charge and everything recorded against it, in cents.
CREATE OR REPLACE FUNCTION public.pal__charge_snapshot(p_charge_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'charge_entry_id', le.id,
    'category',        le.category,
    'rental_id',       le.rental_id,
    'extension_id',    le.extension_id,
    'due_date',        le.due_date,
    'reference',       le.reference,
    'amount_cents',    round(le.amount * 100)::bigint,
    'remaining_cents', round(le.remaining_amount * 100)::bigint,
    'settled_cents',   round((le.amount - le.remaining_amount) * 100)::bigint,
    'applied_cents',   round(COALESCE(a.applied, 0) * 100)::bigint,
    'drift_cents',     round((le.amount - le.remaining_amount - COALESCE(a.applied, 0)) * 100)::bigint,
    'applications',    COALESCE(a.apps, '[]'::jsonb))
  FROM ledger_entries le
  LEFT JOIN LATERAL (
    SELECT sum(pa.amount_applied) AS applied,
           jsonb_agg(jsonb_build_object('payment_id', pa.payment_id,
                                        'applied_cents', round(pa.amount_applied * 100)::bigint)
                     ORDER BY pa.payment_id) AS apps
      FROM payment_applications pa
     WHERE pa.charge_entry_id = le.id
  ) a ON true
 WHERE le.id = p_charge_id
$$;


-- ─── payment_reallocate ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.payment_reallocate(
  p_payment_id uuid, p_targets jsonb, p_reason text, p_note text, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $$
DECLARE
  p             payments;
  v_note        text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_elem        jsonb;
  v_key         text;
  v_id          uuid;
  v_cents       numeric;
  v_ids         uuid[] := '{}';
  v_amts        numeric[] := '{}';
  v_old_ids     uuid[];
  v_all_ids     uuid[];
  v_missing     uuid;
  v_refund      numeric;
  v_net         numeric;
  v_placed      numeric := 0;
  v_unplaced    numeric;
  v_new_status  text;
  v_widened     jsonb;
  v_null_apps   integer;
  v_changes     integer := 0;
  v_delta       numeric;
  v_vehicle     uuid;
  v_source      text;
  v_pnl_id      uuid;
  v_pnl_amount  numeric;
  v_pnl_n       integer;
  v_rows        integer;
  v_before      jsonb;
  v_after       jsonb;
  v_rentals     uuid[];
  v_audit       uuid;
  c             record;
BEGIN
  -- 1. Input shape — nothing is read or locked for a malformed call.
  PERFORM pal__require_reason(p_reason, v_note);
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input: a payment is required' USING ERRCODE = '22023';
  END IF;
  IF p_targets IS NULL OR jsonb_typeof(p_targets) <> 'array' THEN
    RAISE EXCEPTION 'invalid_input: targets must be a list of {charge_entry_id, amount_cents}' USING ERRCODE = '22023';
  END IF;
  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_targets) LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RAISE EXCEPTION 'invalid_input: each target must be {charge_entry_id, amount_cents}' USING ERRCODE = '22023';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_elem) LOOP
      IF v_key NOT IN ('charge_entry_id', 'amount_cents') THEN
        RAISE EXCEPTION 'invalid_input: unknown field "%" in a target — a target is {charge_entry_id, amount_cents} with money in integer cents', v_key
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF jsonb_typeof(v_elem -> 'charge_entry_id') IS DISTINCT FROM 'string'
       OR NOT ((v_elem ->> 'charge_entry_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
      RAISE EXCEPTION 'invalid_input: charge_entry_id must be a charge id (got %)', COALESCE(v_elem -> 'charge_entry_id', 'null'::jsonb)
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_elem -> 'amount_cents') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_input: amount_cents must be a whole number of cents (got %)', COALESCE(v_elem -> 'amount_cents', 'null'::jsonb)
        USING ERRCODE = '22023';
    END IF;
    v_cents := (v_elem ->> 'amount_cents')::numeric;
    IF v_cents <> trunc(v_cents) OR v_cents <= 0 OR v_cents >= 1000000000000 THEN
      RAISE EXCEPTION 'invalid_input: amount_cents must be a positive whole number of cents (got %)', v_elem -> 'amount_cents'
        USING ERRCODE = '22023';
    END IF;
    v_id := (v_elem ->> 'charge_entry_id')::uuid;
    IF v_id = ANY (v_ids) THEN
      RAISE EXCEPTION 'invalid_input: charge % is listed twice — give each charge one amount', v_id USING ERRCODE = '22023';
    END IF;
    v_ids  := v_ids  || v_id;
    v_amts := v_amts || (v_cents / 100);
  END LOOP;

  -- 2. The payment, locked for the rest of the transaction.
  SELECT * INTO p FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: payment % not found', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  -- 3. Who is doing this.
  IF p.tenant_id IS NULL THEN
    RAISE EXCEPTION 'payment_not_eligible: this payment has no company recorded on it, so it cannot be moved here' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pal__assert_actor(p_actor, p.tenant_id);

  -- 4. Is it captured money? (The CAPTURED rule.)
  IF p.capture_status IN ('requires_capture', 'cancelled', 'expired') OR p.status = 'Pending' THEN
    RAISE EXCEPTION 'payment_not_captured: this payment was never collected — there is no money to move' USING ERRCODE = 'P0001';
  END IF;
  IF p.status = 'Completed' THEN
    RAISE EXCEPTION 'payment_not_settled: this payment is still being applied to the bill — try again in a moment' USING ERRCODE = 'P0001';
  END IF;
  IF p.status = 'Reversed' THEN
    RAISE EXCEPTION 'payment_reversed: this payment was reversed — there is no money to move' USING ERRCODE = 'P0001';
  END IF;
  IF p.status = 'Refunded' THEN
    RAISE EXCEPTION 'payment_refunded: this payment was refunded in full — there is no money left to move' USING ERRCODE = 'P0001';
  END IF;
  IF p.status IS NULL OR p.status NOT IN ('Applied', 'Credit', 'Partial', 'Partial Refund') THEN
    RAISE EXCEPTION 'payment_not_eligible: a payment with status % cannot be moved', COALESCE(p.status, 'unknown') USING ERRCODE = 'P0001';
  END IF;

  v_refund := COALESCE(p.refund_amount, 0);
  v_net    := p.amount - v_refund;
  IF v_net < 0 THEN
    RAISE EXCEPTION 'payment_refunded: more was refunded (%) than this payment took (%)', pal__money(v_refund), pal__money(p.amount)
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Lock every charge this call touches, in one order, before reading any.
  SELECT COALESCE(array_agg(pa.charge_entry_id ORDER BY pa.charge_entry_id), '{}')
    INTO v_old_ids
    FROM payment_applications pa
   WHERE pa.payment_id = p.id AND pa.charge_entry_id IS NOT NULL;
  v_all_ids := ARRAY(SELECT DISTINCT x FROM unnest(v_old_ids || v_ids) AS x ORDER BY x);
  PERFORM 1 FROM ledger_entries WHERE id = ANY (v_all_ids) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM payment_applications WHERE payment_id = p.id ORDER BY id FOR UPDATE;

  SELECT x INTO v_missing FROM unnest(v_ids) AS x
   WHERE NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.id = x) LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'not_found: charge % not found', v_missing USING ERRCODE = 'P0002';
  END IF;

  -- 6. Targets: this customer's charges, in this company, amounts owed.
  FOR c IN SELECT le.* FROM ledger_entries le WHERE le.id = ANY (v_ids) ORDER BY le.id LOOP
    IF c.type IS DISTINCT FROM 'Charge' THEN
      RAISE EXCEPTION 'charge_not_eligible: % is a % entry, not a charge', c.id, c.type USING ERRCODE = 'P0001';
    END IF;
    IF c.customer_id IS DISTINCT FROM p.customer_id THEN
      RAISE EXCEPTION 'charge_not_eligible: the % charge % belongs to another customer — a payment can only pay its own customer''s charges', c.category, c.id
        USING ERRCODE = 'P0001';
    END IF;
    IF c.tenant_id IS DISTINCT FROM p.tenant_id THEN
      RAISE EXCEPTION 'charge_not_eligible: the % charge % belongs to another company', c.category, c.id USING ERRCODE = 'P0001';
    END IF;
    IF c.amount <= 0 THEN
      RAISE EXCEPTION 'charge_not_eligible: the % entry % is a credit (%), not an amount owed', c.category, c.id, pal__money(c.amount)
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- 7. Refunded money cannot pay a charge.
  SELECT COALESCE(sum(a), 0) INTO v_placed FROM unnest(v_amts) AS a;
  IF v_placed > v_net THEN
    RAISE EXCEPTION 'over_allocation: this payment can place at most % (% received%), and the amounts add up to %',
      pal__money(v_net), pal__money(p.amount),
      CASE WHEN v_refund > 0 THEN ' less ' || pal__money(v_refund) || ' refunded' ELSE '' END,
      pal__money(v_placed)
      USING ERRCODE = 'P0001';
  END IF;
  v_unplaced := v_net - v_placed;

  IF p.status = 'Partial Refund' THEN
    v_new_status := p.status;
  ELSIF v_refund > 0 THEN
    IF v_unplaced <> 0 THEN
      RAISE EXCEPTION 'refund_status_mismatch: this payment has % refunded but is not marked refunded — place all of its remaining % (or correct the refund first)',
        pal__money(v_refund), pal__money(v_net)
        USING ERRCODE = 'P0001';
    END IF;
    v_new_status := 'Applied';
  ELSIF v_placed = 0 THEN
    v_new_status := 'Credit';
  ELSIF v_unplaced = 0 THEN
    v_new_status := 'Applied';
  ELSE
    v_new_status := 'Partial';
  END IF;

  -- 8. Per charge: up only into what it still owes; down never past its amount.
  FOR c IN
    SELECT le.id, le.amount, le.remaining_amount, le.category, le.due_date, le.entry_date,
           COALESCE(pa.amount_applied, 0) AS old_amt,
           COALESCE(t.amt, 0)             AS new_amt
      FROM ledger_entries le
      LEFT JOIN payment_applications pa ON pa.payment_id = p.id AND pa.charge_entry_id = le.id
      LEFT JOIN unnest(v_ids, v_amts) AS t(id, amt) ON t.id = le.id
     WHERE le.id = ANY (v_all_ids)
     ORDER BY le.id
  LOOP
    v_delta := c.new_amt - c.old_amt;
    IF v_delta > 0 AND c.remaining_amount - v_delta < 0 THEN
      RAISE EXCEPTION 'exceeds_charge_remaining: the % charge due % still owes % (% once this payment''s % is taken off) — % does not fit',
        c.category, COALESCE(c.due_date, c.entry_date), pal__money(c.remaining_amount),
        pal__money(c.remaining_amount + c.old_amt), pal__money(c.old_amt), pal__money(c.new_amt)
        USING ERRCODE = 'P0001';
    END IF;
    IF v_delta < 0 AND c.remaining_amount - v_delta > c.amount THEN
      RAISE EXCEPTION 'charge_would_exceed_amount: taking % off the % charge due % would leave % owed on a % charge — its records already disagree; reconcile it first',
        pal__money(-v_delta), c.category, COALESCE(c.due_date, c.entry_date),
        pal__money(c.remaining_amount - v_delta), pal__money(c.amount)
        USING ERRCODE = 'P0001';
    END IF;
    IF v_delta <> 0 THEN
      v_changes := v_changes + 1;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_null_apps FROM payment_applications WHERE payment_id = p.id AND charge_entry_id IS NULL;
  IF v_changes = 0 AND v_null_apps = 0 THEN
    RAISE EXCEPTION 'no_change: this payment is already placed exactly like that' USING ERRCODE = 'P0001';
  END IF;

  v_before := pal__payment_snapshot(p.id, v_all_ids);

  -- 9. A category-targeted payment: widen its list so the live
  --    enforce_payment_target_categories trigger admits the new targets.
  IF p.target_categories IS NOT NULL AND jsonb_typeof(p.target_categories) = 'array'
     AND jsonb_array_length(p.target_categories) > 0 THEN
    SELECT jsonb_agg(DISTINCT le.category) INTO v_widened
      FROM ledger_entries le
     WHERE le.id = ANY (v_ids) AND NOT (p.target_categories ? le.category);
    IF v_widened IS NOT NULL THEN
      UPDATE payments SET target_categories = p.target_categories || v_widened WHERE id = p.id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RAISE EXCEPTION 'write_failed: payment % target categories were not updated — nothing was changed', p.id USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  -- 10. The writes, charge by charge.
  FOR c IN
    SELECT le.id, le.amount, le.remaining_amount, le.category, le.due_date, le.entry_date,
           le.rental_id, le.vehicle_id, le.reference,
           pa.id                          AS app_id,
           COALESCE(pa.amount_applied, 0) AS old_amt,
           COALESCE(t.amt, 0)             AS new_amt
      FROM ledger_entries le
      LEFT JOIN payment_applications pa ON pa.payment_id = p.id AND pa.charge_entry_id = le.id
      LEFT JOIN unnest(v_ids, v_amts) AS t(id, amt) ON t.id = le.id
     WHERE le.id = ANY (v_all_ids)
     ORDER BY le.id
  LOOP
    v_delta := c.new_amt - c.old_amt;
    CONTINUE WHEN v_delta = 0;

    -- 10a. What the charge still owes (relative: never a stale absolute value).
    UPDATE ledger_entries SET remaining_amount = remaining_amount - v_delta WHERE id = c.id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'write_failed: the % charge % was not updated — nothing was changed', c.category, c.id USING ERRCODE = 'P0001';
    END IF;

    -- 10b. The allocation record.
    IF c.new_amt = 0 THEN
      DELETE FROM payment_applications WHERE id = c.app_id;
    ELSIF c.app_id IS NULL THEN
      INSERT INTO payment_applications (payment_id, charge_entry_id, amount_applied, tenant_id)
      VALUES (p.id, c.id, c.new_amt, p.tenant_id);
    ELSE
      UPDATE payment_applications SET amount_applied = c.new_amt WHERE id = c.app_id;
    END IF;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'write_failed: the allocation of payment % to charge % was not written — nothing was changed', p.id, c.id
        USING ERRCODE = 'P0001';
    END IF;

    -- 10c. Revenue: the (payment, charge) row equals the allocation. Never a deposit.
    IF c.category IS DISTINCT FROM 'Security Deposit' THEN
      v_source := p.id::text || '_' || c.id::text;
      SELECT count(*), min(pe.amount) INTO v_pnl_n, v_pnl_amount FROM pnl_entries pe WHERE pe.source_ref = v_source;
      IF v_pnl_n > 1 THEN
        RAISE EXCEPTION 'write_failed: % revenue rows carry %, expected at most one — nothing was changed', v_pnl_n, v_source
          USING ERRCODE = 'P0001';
      END IF;
      SELECT pe.id INTO v_pnl_id FROM pnl_entries pe WHERE pe.source_ref = v_source FOR UPDATE;
      IF v_pnl_n = 1 AND c.new_amt = 0 THEN
        DELETE FROM pnl_entries WHERE id = v_pnl_id;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
      ELSIF v_pnl_n = 1 AND v_pnl_amount <> c.new_amt THEN
        UPDATE pnl_entries SET amount = c.new_amt WHERE id = v_pnl_id;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
      ELSIF v_pnl_n = 0 AND c.new_amt > 0 THEN
        v_vehicle := CASE WHEN c.rental_id IS NOT DISTINCT FROM p.rental_id
                          THEN COALESCE(p.vehicle_id, c.vehicle_id)
                          ELSE COALESCE(c.vehicle_id, p.vehicle_id) END;
        INSERT INTO pnl_entries (vehicle_id, tenant_id, entry_date, side, category, amount, source_ref)
        VALUES (v_vehicle, p.tenant_id, COALESCE(c.due_date, c.entry_date), 'Revenue',
                pal__pnl_category(c.category), c.new_amt, v_source);
        GET DIAGNOSTICS v_rows = ROW_COUNT;
      ELSE
        v_rows := 1;  -- no row and nothing to book, or already equal
      END IF;
      IF v_rows <> 1 THEN
        RAISE EXCEPTION 'write_failed: the revenue row % was not written — nothing was changed', v_source USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- 10d. A fine whose charge is owed again is no longer paid.
    IF c.category = 'Fine' AND c.remaining_amount <= 0 AND c.remaining_amount - v_delta > 0 THEN
      PERFORM pal__reopen_fine(c.reference);
    END IF;
  END LOOP;

  -- 10e. Allocation rows that point at no charge are superseded by the new list.
  IF v_null_apps > 0 THEN
    DELETE FROM payment_applications WHERE payment_id = p.id AND charge_entry_id IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> v_null_apps THEN
      RAISE EXCEPTION 'write_failed: % allocation rows without a charge, % removed — nothing was changed', v_null_apps, v_rows
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 11. The payment's own state. status only when it changes.
  IF v_new_status IS DISTINCT FROM p.status THEN
    UPDATE payments SET status = v_new_status, remaining_amount = v_unplaced WHERE id = p.id;
  ELSE
    UPDATE payments SET remaining_amount = v_unplaced WHERE id = p.id;
  END IF;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'write_failed: payment % was not updated — nothing was changed', p.id USING ERRCODE = 'P0001';
  END IF;

  -- 12. The audit.
  v_after := pal__payment_snapshot(p.id, v_all_ids);
  v_rentals := ARRAY(
    SELECT DISTINCT r FROM (
      SELECT p.rental_id AS r
      UNION ALL
      SELECT le.rental_id FROM ledger_entries le WHERE le.id = ANY (v_all_ids)
    ) s WHERE r IS NOT NULL ORDER BY r);
  INSERT INTO payment_allocation_changes
    (tenant_id, kind, payment_id, customer_id, rental_ids, reason, note, before, after, created_by, created_by_label)
  VALUES
    (p.tenant_id, 'reallocate', p.id, p.customer_id, v_rentals, btrim(p_reason), v_note, v_before, v_after,
     p_actor, pal__actor_label(p_actor))
  RETURNING id INTO v_audit;
  IF v_audit IS NULL THEN
    RAISE EXCEPTION 'write_failed: the audit row was not written — nothing was changed' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_audit;
END;
$$;

COMMENT ON FUNCTION public.payment_reallocate(uuid, jsonb, text, text, uuid) IS
  'Replace a captured payment''s allocation with p_targets [{charge_entry_id, amount_cents}] in one transaction: ledger remaining, payment_applications, P&L (FIFO-keyed), payment status/remaining, and an audit row (returned). Refuses with ''<code>: <sentence>''.';


-- ─── charge_recompute_remaining ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.charge_recompute_remaining(
  p_charge_id uuid, p_reason text, p_actor uuid, p_note text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $$
DECLARE
  c          ledger_entries;
  v_note     text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_applied  numeric;
  v_new      numeric;
  v_before   jsonb;
  v_after    jsonb;
  v_rows     integer;
  v_audit    uuid;
BEGIN
  PERFORM pal__require_reason(p_reason, v_note);
  IF p_charge_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input: a charge is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO c FROM ledger_entries WHERE id = p_charge_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: charge % not found', p_charge_id USING ERRCODE = 'P0002';
  END IF;
  IF c.tenant_id IS NULL THEN
    RAISE EXCEPTION 'charge_not_eligible: this entry has no company recorded on it' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pal__assert_actor(p_actor, c.tenant_id);
  IF c.type IS DISTINCT FROM 'Charge' THEN
    RAISE EXCEPTION 'charge_not_eligible: % is a % entry, not a charge', c.id, c.type USING ERRCODE = 'P0001';
  END IF;

  -- The allocations this recompute reads cannot change under it.
  PERFORM 1 FROM payment_applications WHERE charge_entry_id = c.id ORDER BY id FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM v_ledger_allocation_drift d WHERE d.charge_entry_id = c.id) THEN
    RAISE EXCEPTION 'not_drifted: this charge already ties out — what is marked paid equals the payments recorded against it' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(amount_applied), 0) INTO v_applied FROM payment_applications WHERE charge_entry_id = c.id;
  -- Negative when the payments recorded against the charge exceed it: that is
  -- the charge's true state (an overpayment, shown as credit), it attracts no
  -- FIFO money (the FIFO reads remaining_amount > 0 only), and moving the
  -- excess off with payment_reallocate brings it back to 0.
  v_new := c.amount - v_applied;

  v_before := pal__charge_snapshot(c.id);
  UPDATE ledger_entries SET remaining_amount = v_new WHERE id = c.id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'write_failed: the % charge % was not updated — nothing was changed', c.category, c.id USING ERRCODE = 'P0001';
  END IF;
  IF c.category = 'Fine' AND c.remaining_amount <= 0 AND v_new > 0 THEN
    PERFORM pal__reopen_fine(c.reference);
  END IF;
  v_after := pal__charge_snapshot(c.id);

  INSERT INTO payment_allocation_changes
    (tenant_id, kind, charge_entry_id, customer_id, rental_ids, reason, note, before, after, created_by, created_by_label)
  VALUES
    (c.tenant_id, 'recompute_remaining', c.id, c.customer_id,
     CASE WHEN c.rental_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[c.rental_id] END,
     btrim(p_reason), v_note, v_before, v_after, p_actor, pal__actor_label(p_actor))
  RETURNING id INTO v_audit;
  IF v_audit IS NULL THEN
    RAISE EXCEPTION 'write_failed: the audit row was not written — nothing was changed' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_audit;
END;
$$;

COMMENT ON FUNCTION public.charge_recompute_remaining(uuid, text, uuid, text) IS
  'For ONE charge listed in v_ledger_allocation_drift: remaining_amount := amount - Σ payment_applications, with an audit row (returned). P&L is not touched (it follows allocations, which do not change).';


-- ─── bill_reconcile_options ────────────────────────────────────────────────
-- READ-ONLY (STABLE: Postgres itself refuses a write from inside it).
--
-- The bill: every Charge of the rental, or of one extension when p_extension_id
-- is given. A charge does not tie out when
--   drift = (amount − remaining_amount) − Σ applications ≠ 0   — exactly the
--           v_ledger_allocation_drift condition, or
--   Σ applications > amount                                   — payments
--           recorded against it exceed the charge (e.g. after a recompute).
-- For each, `fixes` lists alternative plans; each plan is `steps` to run in
-- order through the payment-reallocate edge function, with exact amounts, and
-- every step is safe on its own if the next one is never run.
--
--   settled_without_payment (drift > 0): part of the charge is marked paid but
--     no payment is recorded against it.
--       reopen          recompute → the customer owes it again
--       use_payment     recompute, then reallocate a named payment of the same
--                       customer that has money not placed on any charge
--       write_off       recompute, then a goodwill adjustment of the same
--                       amount (adjust-customer-balance v2: kind 'goodwill',
--                       direction 'decrease' — 20260926120000)
--   payments_exceed_settled (drift < 0, applications ≤ amount): payments
--     recorded against it cover more than is marked paid.
--       recompute       → remaining = amount − Σ applications
--   payments_exceed_charge (applications > amount):
--       move_excess     reallocate the excess of the latest eligible payments
--                       off this charge (it becomes unused credit on those
--                       payments), with a recompute before or after — before
--                       when the records disagree so far that moving first
--                       would re-open more than the charge.
-- Only payments reallocation accepts are proposed: captured Applied / Credit /
-- Partial with no refund recorded (a partly refunded payment can still be
-- moved by hand; its before/after shows what the refund takes with it).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bill_reconcile_options(p_rental_id uuid, p_extension_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $$
DECLARE
  r             record;
  ch            record;
  pay           record;
  v_charges     jsonb := '[]'::jsonb;
  v_fixes       jsonb;
  v_steps       jsonb;
  v_apps        jsonb;
  v_targets     jsonb;
  v_changes     jsonb;
  v_amount      bigint;
  v_remaining   bigint;
  v_applied     bigint;
  v_drift       bigint;
  v_over        bigint;
  v_left        bigint;
  v_x           bigint;
  v_moved       bigint;
  v_after_rem   bigint;
  v_recompute   jsonb;
  v_first       boolean;
  v_problem     text;
  v_explain     text;
  v_n           integer;
  t_charged     bigint := 0;
  t_settled     bigint := 0;
  t_applied     bigint := 0;
  t_gap         bigint := 0;
  t_over        bigint := 0;
  t_checked     integer := 0;
BEGIN
  IF p_rental_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input: a rental is required' USING ERRCODE = '22023';
  END IF;
  SELECT id, tenant_id, customer_id INTO r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: rental % not found', p_rental_id USING ERRCODE = 'P0002';
  END IF;
  IF p_extension_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM rental_extensions re WHERE re.id = p_extension_id AND re.rental_id = p_rental_id) THEN
    RAISE EXCEPTION 'not_found: extension % is not an extension of rental %', p_extension_id, p_rental_id USING ERRCODE = 'P0002';
  END IF;

  FOR ch IN
    SELECT le.id, le.category, le.due_date, le.entry_date, le.reference, le.extension_id, le.customer_id,
           round(le.amount * 100)::bigint                                   AS amount_c,
           round(le.remaining_amount * 100)::bigint                         AS remaining_c,
           round(COALESCE(a.applied, 0) * 100)::bigint                      AS applied_c
      FROM ledger_entries le
      LEFT JOIN LATERAL (SELECT sum(pa.amount_applied) AS applied
                           FROM payment_applications pa WHERE pa.charge_entry_id = le.id) a ON true
     WHERE le.rental_id = p_rental_id
       AND le.type = 'Charge'
       AND (p_extension_id IS NULL OR le.extension_id = p_extension_id)
     ORDER BY le.due_date NULLS LAST, le.category, le.id
  LOOP
    t_checked   := t_checked + 1;
    v_amount    := ch.amount_c;
    v_remaining := ch.remaining_c;
    v_applied   := ch.applied_c;
    v_drift     := (v_amount - v_remaining) - v_applied;
    v_over      := GREATEST(v_applied - GREATEST(v_amount, 0), 0);
    t_charged   := t_charged + v_amount;
    t_settled   := t_settled + (v_amount - v_remaining);
    t_applied   := t_applied + v_applied;
    t_gap       := t_gap + v_drift;
    t_over      := t_over + v_over;
    CONTINUE WHEN v_drift = 0 AND v_over = 0;

    -- Payments recorded against this charge.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'payment_id',     x.payment_id,
             'applied_cents',  x.applied_c,
             'pnl_cents',      x.pnl_c,
             'payment_status', x.status,
             'payment_date',   x.payment_date,
             'method',         x.method,
             'net_cents',      x.net_c,
             'unplaced_cents', x.unplaced_c,
             'movable',        x.movable)
           ORDER BY x.payment_date DESC NULLS LAST, x.payment_id DESC), '[]'::jsonb)
      INTO v_apps
      FROM (
        SELECT pa.payment_id,
               round(pa.amount_applied * 100)::bigint AS applied_c,
               (SELECT round(sum(pe.amount) * 100)::bigint FROM pnl_entries pe
                 WHERE pe.source_ref = pa.payment_id::text || '_' || ch.id::text) AS pnl_c,
               p.status, p.payment_date, p.method,
               round((p.amount - COALESCE(p.refund_amount, 0)) * 100)::bigint AS net_c,
               round((p.amount - COALESCE(p.refund_amount, 0)
                      - COALESCE((SELECT sum(q.amount_applied) FROM payment_applications q WHERE q.payment_id = p.id), 0)) * 100)::bigint AS unplaced_c,
               (p.status IN ('Applied', 'Credit', 'Partial')
                AND COALESCE(p.refund_amount, 0) = 0
                AND (p.capture_status IS NULL OR p.capture_status = 'captured')
                AND p.tenant_id = r.tenant_id) AS movable
          FROM payment_applications pa
          JOIN payments p ON p.id = pa.payment_id
         WHERE pa.charge_entry_id = ch.id
      ) x;

    v_fixes := '[]'::jsonb;
    v_recompute := jsonb_build_object(
      'action', 'recompute_charge', 'charge_entry_id', ch.id,
      'remaining_cents_before', v_remaining, 'remaining_cents_after', v_amount - v_applied);

    IF v_over > 0 THEN
      -- ── payments_exceed_charge ─────────────────────────────────────────
      v_problem := 'payments_exceed_charge';
      v_explain := format('Payments recorded against this %s charge add up to %s, but the charge is only %s: %s too much is recorded here.',
                          ch.category, pal__money(v_applied / 100.0), pal__money(v_amount / 100.0), pal__money(v_over / 100.0));
      v_steps := '[]'::jsonb;
      -- Recompute first when moving first would re-open past the charge's amount.
      v_first := v_drift <> 0 AND v_remaining + v_over > v_amount;
      IF v_first THEN
        v_steps := v_steps || jsonb_build_array(v_recompute);
      END IF;
      v_left := v_over;
      v_moved := 0;
      FOR pay IN
        SELECT pa.payment_id, round(pa.amount_applied * 100)::bigint AS applied_c,
               round((p.amount - COALESCE(p.refund_amount, 0)) * 100)::bigint AS net_c
          FROM payment_applications pa
          JOIN payments p ON p.id = pa.payment_id
         WHERE pa.charge_entry_id = ch.id
           AND p.status IN ('Applied', 'Credit', 'Partial')
           AND COALESCE(p.refund_amount, 0) = 0
           AND (p.capture_status IS NULL OR p.capture_status = 'captured')
           AND p.tenant_id = r.tenant_id
         ORDER BY p.payment_date DESC NULLS LAST, p.created_at DESC, p.id DESC
      LOOP
        EXIT WHEN v_left <= 0;
        v_x := LEAST(pay.applied_c, v_left);
        -- The payment's complete new allocation: everything as it is, this
        -- charge reduced by v_x (dropped when it reaches 0).
        SELECT COALESCE(jsonb_agg(jsonb_build_object('charge_entry_id', q.charge_entry_id, 'amount_cents', q.cents)
                                  ORDER BY q.charge_entry_id), '[]'::jsonb)
          INTO v_targets
          FROM (SELECT pa2.charge_entry_id,
                       round(pa2.amount_applied * 100)::bigint - CASE WHEN pa2.charge_entry_id = ch.id THEN v_x ELSE 0 END AS cents
                  FROM payment_applications pa2
                 WHERE pa2.payment_id = pay.payment_id AND pa2.charge_entry_id IS NOT NULL) q
         WHERE q.cents > 0;
        -- A payment already over-placed overall cannot be proposed as is.
        CONTINUE WHEN (SELECT COALESCE(sum((e ->> 'amount_cents')::bigint), 0) FROM jsonb_array_elements(v_targets) e) > pay.net_c;
        v_steps := v_steps || jsonb_build_array(jsonb_build_object(
          'action', 'reallocate', 'payment_id', pay.payment_id, 'targets', v_targets,
          'changes', jsonb_build_array(jsonb_build_object('charge_entry_id', ch.id,
                                                          'from_cents', pay.applied_c,
                                                          'to_cents', pay.applied_c - v_x)),
          'unplaced_cents_added', v_x));
        v_left := v_left - v_x;
        v_moved := v_moved + v_x;
      END LOOP;
      IF NOT v_first AND v_drift <> 0 THEN
        v_steps := v_steps || jsonb_build_array(jsonb_build_object(
          'action', 'recompute_charge', 'charge_entry_id', ch.id,
          'remaining_cents_before', v_remaining + v_moved,
          'remaining_cents_after', v_amount - (v_applied - v_moved)));
      END IF;
      v_after_rem := v_amount - (v_applied - v_moved);
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object(
        'kind', 'move_excess',
        'label', CASE WHEN v_moved > 0
                      THEN format('Move the %s recorded too much off this charge; it becomes unused credit on the payment it came from',
                                  pal__money(v_moved / 100.0))
                      ELSE 'The excess is on payments that cannot be moved from here' END,
        'result', CASE WHEN v_left = 0
                       THEN format('The charge ties out with %s owed.', pal__money(v_after_rem / 100.0))
                       ELSE format('%s of the excess is on payments that cannot be moved here (refunded, reversed or not captured) — record an adjustment for it.',
                                   pal__money(v_left / 100.0)) END,
        'remaining_cents_after', v_after_rem,
        'unresolved_cents', v_left,
        'steps', v_steps));

    ELSIF v_drift > 0 THEN
      -- ── settled_without_payment ────────────────────────────────────────
      v_problem := 'settled_without_payment';
      v_explain := format('%s of this %s charge is marked paid, but no payment is recorded against it (marked paid %s; payments recorded %s).',
                          pal__money(v_drift / 100.0), ch.category,
                          pal__money((v_amount - v_remaining) / 100.0), pal__money(v_applied / 100.0));
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object(
        'kind', 'reopen',
        'label', format('Re-open the %s — the customer owes it again', pal__money(v_drift / 100.0)),
        'result', format('The charge ties out with %s owed.', pal__money((v_amount - v_applied) / 100.0)),
        'remaining_cents_after', v_amount - v_applied,
        'steps', jsonb_build_array(v_recompute)));

      v_n := 0;
      FOR pay IN
        SELECT p.id AS payment_id, p.payment_date, p.method, p.rental_id,
               round((p.amount - COALESCE(p.refund_amount, 0)
                      - COALESCE((SELECT sum(q.amount_applied) FROM payment_applications q WHERE q.payment_id = p.id), 0)) * 100)::bigint AS unplaced_c,
               EXISTS (SELECT 1 FROM payment_applications q WHERE q.payment_id = p.id AND q.charge_entry_id = ch.id) AS on_this_charge
          FROM payments p
         WHERE p.customer_id = ch.customer_id
           AND p.tenant_id = r.tenant_id
           AND p.status IN ('Applied', 'Credit', 'Partial')
           AND COALESCE(p.refund_amount, 0) = 0
           AND (p.capture_status IS NULL OR p.capture_status = 'captured')
         -- A payment already on this charge first (its missing part is most
         -- likely the dropped allocation), then this rental's, then newest.
         ORDER BY on_this_charge DESC, (p.rental_id IS NOT DISTINCT FROM p_rental_id) DESC, p.payment_date DESC NULLS LAST, p.id
      LOOP
        CONTINUE WHEN pay.unplaced_c <= 0;
        EXIT WHEN v_n >= 3;
        v_x := LEAST(v_drift, pay.unplaced_c, v_amount - v_applied);
        CONTINUE WHEN v_x <= 0;
        SELECT COALESCE(jsonb_agg(jsonb_build_object('charge_entry_id', q.charge_entry_id, 'amount_cents', q.cents)
                                  ORDER BY q.charge_entry_id), '[]'::jsonb)
          INTO v_targets
          FROM (SELECT pa2.charge_entry_id,
                       round(pa2.amount_applied * 100)::bigint + CASE WHEN pa2.charge_entry_id = ch.id THEN v_x ELSE 0 END AS cents
                  FROM payment_applications pa2
                 WHERE pa2.payment_id = pay.payment_id AND pa2.charge_entry_id IS NOT NULL
                UNION ALL
                SELECT ch.id, v_x WHERE NOT pay.on_this_charge) q;
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object(
          'kind', 'use_payment',
          'payment_id', pay.payment_id,
          'label', format('Re-open it and pay %s of it from the payment of %s (%s) that is not placed on any charge',
                          pal__money(v_x / 100.0), COALESCE(pay.payment_date::text, 'unknown date'), COALESCE(pay.method, 'unknown method')),
          'result', format('The charge ties out with %s owed.', pal__money((v_amount - v_applied - v_x) / 100.0)),
          'remaining_cents_after', v_amount - v_applied - v_x,
          'steps', jsonb_build_array(
            v_recompute,
            jsonb_build_object('action', 'reallocate', 'payment_id', pay.payment_id, 'targets', v_targets,
                               'changes', jsonb_build_array(jsonb_build_object(
                                 'charge_entry_id', ch.id,
                                 'from_cents', CASE WHEN pay.on_this_charge THEN
                                   (SELECT round(q.amount_applied * 100)::bigint FROM payment_applications q
                                     WHERE q.payment_id = pay.payment_id AND q.charge_entry_id = ch.id) ELSE 0 END,
                                 'to_cents', CASE WHEN pay.on_this_charge THEN
                                   (SELECT round(q.amount_applied * 100)::bigint FROM payment_applications q
                                     WHERE q.payment_id = pay.payment_id AND q.charge_entry_id = ch.id) ELSE 0 END + v_x)),
                               'unplaced_cents_used', v_x))));
        v_n := v_n + 1;
      END LOOP;

      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object(
        'kind', 'write_off',
        'label', format('Re-open it and write the %s off as an adjustment (the balance does not change)', pal__money(v_drift / 100.0)),
        'result', format('The charge ties out with %s owed, offset by a %s credit adjustment.',
                         pal__money((v_amount - v_applied) / 100.0), pal__money(v_drift / 100.0)),
        'remaining_cents_after', v_amount - v_applied,
        'steps', jsonb_build_array(
          v_recompute,
          -- The Wave 1 v2 request (adjust-customer-balance/core.ts, kind
          -- 'goodwill' → balance_adjust); the operator adds the note.
          jsonb_build_object('action', 'record_adjustment', 'via', 'adjust-customer-balance',
                             'amount_cents', v_drift,
                             'body', jsonb_build_object(
                               'kind', 'goodwill', 'direction', 'decrease',
                               'amount', round(v_drift / 100.0, 2), 'reason_code', 'other',
                               'customerId', ch.customer_id, 'tenantId', r.tenant_id,
                               'rentalId', p_rental_id, 'extensionId', ch.extension_id)))));

    ELSE
      -- ── payments_exceed_settled (drift < 0, applications fit the charge) ─
      v_problem := 'payments_exceed_settled';
      v_explain := format('Payments recorded against this %s charge add up to %s, but only %s of it is marked paid: %s more is paid than the charge shows.',
                          ch.category, pal__money(v_applied / 100.0),
                          pal__money((v_amount - v_remaining) / 100.0), pal__money(-v_drift / 100.0));
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object(
        'kind', 'recompute',
        'label', format('Mark the %s the payments already cover as paid', pal__money(-v_drift / 100.0)),
        'result', format('The charge ties out with %s owed.', pal__money((v_amount - v_applied) / 100.0)),
        'remaining_cents_after', v_amount - v_applied,
        'steps', jsonb_build_array(v_recompute)));
    END IF;

    v_charges := v_charges || jsonb_build_array(jsonb_build_object(
      'charge_entry_id', ch.id,
      'category',        ch.category,
      'due_date',        ch.due_date,
      'reference',       ch.reference,
      'extension_id',    ch.extension_id,
      'amount_cents',    v_amount,
      'remaining_cents', v_remaining,
      'settled_cents',   v_amount - v_remaining,
      'applied_cents',   v_applied,
      'drift_cents',     v_drift,
      'over_applied_cents', v_over,
      'in_drift_view',   v_drift <> 0,
      'problem',         v_problem,
      'explanation',     v_explain,
      'applications',    v_apps,
      'fixes',           v_fixes));
  END LOOP;

  RETURN jsonb_build_object(
    'rental_id',     p_rental_id,
    'extension_id',  p_extension_id,
    'tenant_id',     r.tenant_id,
    'customer_id',   r.customer_id,
    'ties_out',      jsonb_array_length(v_charges) = 0,
    'totals',        jsonb_build_object(
                       'charges_checked',     t_checked,
                       'charged_cents',       t_charged,
                       'settled_cents',       t_settled,
                       'applied_cents',       t_applied,
                       'gap_cents',           t_gap,
                       'over_applied_cents',  t_over),
    'charges',       v_charges,
    'open_charges',  COALESCE((
      SELECT jsonb_agg(jsonb_build_object('charge_entry_id', le.id, 'category', le.category, 'due_date', le.due_date,
                                          'extension_id', le.extension_id,
                                          'remaining_cents', round(le.remaining_amount * 100)::bigint)
                       ORDER BY le.due_date NULLS LAST, le.category, le.id)
        FROM ledger_entries le
       WHERE le.rental_id = p_rental_id AND le.type = 'Charge' AND le.remaining_amount > 0
         AND (p_extension_id IS NULL OR le.extension_id = p_extension_id)), '[]'::jsonb),
    'unplaced_payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('payment_id', u.id, 'rental_id', u.rental_id, 'payment_date', u.payment_date,
                                          'method', u.method, 'status', u.status, 'unplaced_cents', u.unplaced_c)
                       ORDER BY u.payment_date DESC NULLS LAST, u.id)
        FROM (SELECT p.id, p.rental_id, p.payment_date, p.method, p.status,
                     round((p.amount - COALESCE(p.refund_amount, 0)
                            - COALESCE((SELECT sum(q.amount_applied) FROM payment_applications q WHERE q.payment_id = p.id), 0)) * 100)::bigint AS unplaced_c
                FROM payments p
               WHERE p.customer_id = r.customer_id AND p.tenant_id = r.tenant_id
                 AND p.status IN ('Applied', 'Credit', 'Partial')
                 AND COALESCE(p.refund_amount, 0) = 0
                 AND (p.capture_status IS NULL OR p.capture_status = 'captured')) u
       WHERE u.unplaced_c > 0), '[]'::jsonb));
END;
$$;

COMMENT ON FUNCTION public.bill_reconcile_options(uuid, uuid) IS
  'Read-only. Why a rental''s (or one extension''s) charges do not tie out, and the exact payment-reallocate steps that would close each gap. Amounts in integer cents.';


-- ─── Privileges: service_role only ─────────────────────────────────────────
-- Explicit list, so nothing outside this migration can be caught by it.

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
         'payment_allocation_changes_append_only',
         'pal__pnl_category', 'pal__money', 'pal__assert_actor', 'pal__actor_label', 'pal__require_reason', 'pal__reopen_fine',
         'pal__payment_snapshot', 'pal__charge_snapshot',
         'payment_reallocate', 'charge_recompute_remaining', 'bill_reconcile_options'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END;
$$;
