-- ============================================================================
-- Ledger allocation prerequisites for payment plans (Plan B, slice 1)
-- docs/PAYMENT_PLANS_DESIGN.md §4.1
--
-- NOT APPLIED. A file only. Applying it is a separate, explicit approval.
--
-- WHY
-- ---
-- Payment plans take money through the existing engine: a `payments` row with
-- status 'Completed' fires `auto_fifo_on_payment_insert` → payment_apply_fifo_v2,
-- which allocates it to the rental's ledger charges. That function has three
-- measured defects the plan engine would otherwise inherit. Measured on
-- production, Sep 25 2026:
--
--   * 15 of 2,311 charges have drifted: amount − remaining_amount ≠
--     Σ payment_applications.amount_applied. A second application of the same
--     payment to the same charge decremented remaining_amount and added to the
--     P&L row, but `ON CONFLICT … DO NOTHING` dropped the allocation record.
--   * 'Excess Mileage' is invisible to FIFO (INNER JOIN on a hard-coded
--     category list) — 4 open Excess Mileage charges can never be settled by a
--     payment. The same is true of every ledger category missing from the list:
--     'Unlimited Mileage', 'Supercharger', 'InitialFee', 'Initial Fees',
--     'Adjustment', 'Extension', and the new 'Extension Add-on'.
--   * The auto-extend extras insert writes category 'Extension Add-on', which
--     ledger_entries_category_check does not allow — that insert can only fail.
--
-- SOURCE
-- ------
-- payment_apply_fifo_v2 below is the LIVE body (pg_get_functiondef, Sep 25
-- 2026, tests/payment-plans/fixtures/live-functions-2026-09-25.sql), NOT the
-- repo migration copy, which is stale (live has 'Fine' AND 'Fines' at 12,
-- 'Security Deposit' at 14, and never books a deposit to P&L). Same language,
-- same security (invoker, no SET search_path — it is only reached through the
-- SECURITY DEFINER triggers), same signature. Everything not listed under
-- CHANGES is byte-for-byte the live logic.
--
-- CHANGES
-- -------
-- 1. cat_order is a VALUES list, joined with LEFT JOIN, ordered by
--    COALESCE(pri, 13.5): a category nobody listed is settled just before
--    Security Deposit instead of vanishing. Every existing priority is
--    unchanged (Rental 1 … Other 13, Security Deposit 14). The newly listed
--    categories all sit in (13, 14):
--       13.1  InitialFee, Initial Fees
--       13.2  Extension, Extension Add-on
--       13.3  Unlimited Mileage, Excess Mileage, Supercharger
--       13.4  Adjustment
--       13.5  anything unlisted (fallback)
--    Placing them after every existing earned category is the strictly
--    additive choice: for any payment, the 14 existing earned categories are
--    settled in exactly the same order and amounts as before. Only money that
--    would previously have reached Security Deposit, or stayed as Credit, can
--    now reach a newly visible charge — and earned money before refundable
--    money is the rule the live header already states for the deposit.
-- 2. The P&L category is mapped so a newly reachable ledger category can never
--    abort a payment on the pnl_entries category CHECK:
--       Fine → Fines, InitialFee → Initial Fees, Extension Add-on → Extras,
--       and anything else not in the constraint's list → Other
--    ('Adjustment' and 'Supercharger' are the two such ledger categories
--    today). The allowed list is written out below; a test asserts it equals
--    the constraint's list exactly (tests/payment-plans/sql/prerequisites.test.ts).
--    The Security Deposit guard (never booked as revenue) is unchanged.
-- 3. payment_applications: ON CONFLICT ON CONSTRAINT ux_payment_app_unique
--    DO UPDATE SET amount_applied = amount_applied + EXCLUDED.amount_applied.
--    The allocation record now moves in step with the remaining_amount
--    decrement and the (already additive) P&L row. This stops NEW drift; it
--    does not repair the 15 existing rows.
-- 4. ledger_entries_category_check += 'Extension Add-on'.
-- 5. payments_booking_source_check += 'payment_plan' (payments written by
--    pp_record_success, migration 20260925120100).
-- 6. v_ledger_allocation_drift — read-only report of drifted charges.
--    security_invoker = on. SELECT is granted to service_role ONLY, and
--    revoked from PUBLIC, anon and authenticated. Justification: under
--    security_invoker a staff reader would see what the underlying policies
--    allow, and payment_applications' live policy is
--    "Allow all operations for app users" (roles public, USING true) — it does
--    not isolate tenants, so a staff grant would leak other tenants' drift. The
--    only consumer is operations (service role / SQL editor as postgres),
--    before a per-row repair that needs sign-off anyway.
--
-- NO DATA REPAIR. The 15 drifted charges are left exactly as they are; repairs
-- are per-row and need sign-off (the view is how to find them).
--
-- Idempotent: CREATE OR REPLACE for the function and view, DROP CONSTRAINT IF
-- EXISTS … ADD for the two CHECKs (the widened lists are supersets, so every
-- existing row still satisfies them).
-- ============================================================================


-- 1–3. payment_apply_fifo_v2 ------------------------------------------------

CREATE OR REPLACE FUNCTION public.payment_apply_fifo_v2(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_amt NUMERIC;
  v_already NUMERIC;
  v_left NUMERIC;
  v_rental UUID;
  v_customer UUID;
  v_vehicle UUID;
  v_tenant UUID;
  v_pay_date DATE;
  v_is_early BOOLEAN;
  v_extension UUID;
  v_targets_jsonb JSONB;
  v_targets TEXT[];
  c RECORD;
  to_apply NUMERIC;
  next_due_date DATE;
  v_pnl_cat TEXT;
BEGIN
  SELECT amount, rental_id, customer_id, vehicle_id, payment_date, is_early, extension_id, target_categories, tenant_id
    INTO v_amt, v_rental, v_customer, v_vehicle, v_pay_date, v_is_early, v_extension, v_targets_jsonb, v_tenant
  FROM payments WHERE id = p_id;

  IF v_customer IS NULL THEN RETURN; END IF;

  -- Belt-and-braces: a payment row missing tenant_id would otherwise orphan
  -- every P&L row it writes (invisible to the tenant-scoped P&L dashboard).
  IF v_tenant IS NULL AND v_vehicle IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant FROM vehicles WHERE id = v_vehicle;
  END IF;

  IF v_targets_jsonb IS NOT NULL AND jsonb_typeof(v_targets_jsonb) = 'array' THEN
    SELECT ARRAY(SELECT jsonb_array_elements_text(v_targets_jsonb)) INTO v_targets;
  END IF;

  SELECT COALESCE(SUM(amount_applied), 0) INTO v_already
  FROM payment_applications WHERE payment_id = p_id;

  v_left := v_amt - v_already;
  IF v_left <= 0 THEN
    UPDATE payments SET status = 'Applied', remaining_amount = 0 WHERE id = p_id;
    RETURN;
  END IF;

  IF NOT v_is_early THEN
    SELECT MIN(due_date) INTO next_due_date
    FROM ledger_entries
    WHERE customer_id = v_customer AND type='Charge' AND category='Rental' AND remaining_amount > 0;

    IF next_due_date IS NOT NULL AND v_pay_date < next_due_date THEN
      v_is_early := TRUE;
      UPDATE payments SET is_early = TRUE WHERE id = p_id;
    END IF;
  END IF;

  FOR c IN
    WITH cat_order(cat, pri) AS (
      VALUES
        -- Existing priorities: unchanged.
        ('Rental'::text,            1::numeric),
        ('Tax',                     2),
        ('Service Fee',             3),
        ('Delivery Fee',            4),
        ('Collection Fee',          5),
        ('Insurance',               6),
        ('Extras',                  7),
        ('Extension Rental',        8),
        ('Extension Tax',           9),
        ('Extension Service Fee',  10),
        ('Extension Insurance',    11),
        ('Fine',                   12),
        ('Fines',                  12),
        ('Other',                  13),
        -- Newly visible: after every existing earned category, before the
        -- deposit. See the header for why here.
        ('InitialFee',             13.1),
        ('Initial Fees',           13.1),
        ('Extension',              13.2),
        ('Extension Add-on',       13.2),
        ('Unlimited Mileage',      13.3),
        ('Excess Mileage',         13.3),
        ('Supercharger',           13.3),
        ('Adjustment',             13.4),
        -- Deliberately last: refundable money, not earned money. See header.
        ('Security Deposit',       14)
    )
    SELECT le.id, le.remaining_amount, le.due_date, le.category,
           COALESCE(co.pri, 13.5) AS pri
      FROM ledger_entries le
      LEFT JOIN cat_order co ON co.cat = le.category
     WHERE le.customer_id = v_customer
       AND le.type = 'Charge'
       AND le.remaining_amount > 0
       AND (v_rental IS NULL OR le.rental_id = v_rental)
       AND (v_extension IS NULL OR le.extension_id = v_extension OR le.category NOT LIKE 'Extension%')
       AND (v_targets IS NULL OR cardinality(v_targets) = 0 OR le.category = ANY(v_targets))
     ORDER BY COALESCE(co.pri, 13.5) ASC, le.due_date ASC, le.entry_date ASC, le.id ASC
  LOOP
    EXIT WHEN v_left <= 0;
    to_apply := LEAST(c.remaining_amount, v_left);

    -- Accumulate, never drop: the allocation record moves in step with the
    -- remaining_amount decrement below and with the additive P&L row.
    INSERT INTO payment_applications(payment_id, charge_entry_id, amount_applied)
    VALUES (p_id, c.id, to_apply)
    ON CONFLICT ON CONSTRAINT ux_payment_app_unique
    DO UPDATE SET amount_applied = payment_applications.amount_applied + EXCLUDED.amount_applied;

    UPDATE ledger_entries
       SET remaining_amount = remaining_amount - to_apply
     WHERE id = c.id;

    -- A security deposit is a LIABILITY, not revenue: it is the renter's money
    -- held against damage, refundable in full or in part at the end of the
    -- rental. Booking it as Revenue overstates earnings now and would need a
    -- negative correction at refund time. the pnl_entries category CHECK ALLOWS
    -- 'Security Deposit', so nothing but this guard stops it. The ledger is the
    -- sole record of deposits; P&L sees them only if they are forfeited, which
    -- is recorded separately as a Fine/Other charge.
    IF c.category <> 'Security Deposit' THEN
      -- The ledger and P&L vocabularies differ. Map the names that differ, and
      -- send anything the P&L constraint does not allow to 'Other', so a
      -- ledger category can never abort a payment on the pnl_entries category CHECK.
      -- KEEP-IN-SYNC with the pnl_entries category CHECK (a test compares the lists).
      v_pnl_cat := CASE c.category
                     WHEN 'Fine'             THEN 'Fines'
                     WHEN 'InitialFee'       THEN 'Initial Fees'
                     WHEN 'Extension Add-on' THEN 'Extras'
                     ELSE c.category
                   END;
      IF v_pnl_cat IS NULL OR NOT (v_pnl_cat = ANY (ARRAY[
           'Initial Fees', 'Rental', 'Acquisition', 'Finance', 'Service',
           'Fines', 'Other', 'Disposal', 'Plates', 'Insurance', 'Delivery Fee',
           'Collection Fee', 'Extras', 'Security Deposit', 'Extension',
           'Extension Rental', 'Extension Tax', 'Extension Service Fee',
           'Extension Insurance', 'Excess Mileage', 'Unlimited Mileage', 'Tax',
           'Service Fee', 'Expenses'
         ]::text[])) THEN
        v_pnl_cat := 'Other';
      END IF;

      INSERT INTO pnl_entries(vehicle_id, tenant_id, entry_date, side, category, amount, source_ref)
      VALUES (v_vehicle, v_tenant, c.due_date, 'Revenue',
              v_pnl_cat,
              to_apply, p_id::text || '_' || c.id::text)
      ON CONFLICT (vehicle_id, category, source_ref)
      DO UPDATE SET amount = pnl_entries.amount + EXCLUDED.amount;
    END IF;

    v_left := v_left - to_apply;
  END LOOP;

  IF v_left <= 0 THEN
    UPDATE payments SET status = 'Applied', remaining_amount = 0 WHERE id = p_id;
  ELSIF v_left = v_amt THEN
    UPDATE payments SET status = 'Credit', remaining_amount = v_left WHERE id = p_id;
  ELSE
    UPDATE payments SET status = 'Partial', remaining_amount = v_left WHERE id = p_id;
  END IF;
END;
$function$;


-- 4. ledger_entries_category_check += 'Extension Add-on' ---------------------

ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_category_check;
ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_category_check
  CHECK (category = ANY (ARRAY[
    'Rental'::text, 'InitialFee'::text, 'Initial Fees'::text, 'Fine'::text,
    'Fines'::text, 'Adjustment'::text, 'Tax'::text, 'Service Fee'::text,
    'Security Deposit'::text, 'Extension'::text, 'Extension Rental'::text,
    'Extension Tax'::text, 'Extension Service Fee'::text,
    'Extension Insurance'::text, 'Excess Mileage'::text,
    'Unlimited Mileage'::text, 'Insurance'::text, 'Delivery Fee'::text,
    'Collection Fee'::text, 'Extras'::text, 'Supercharger'::text,
    'Other'::text,
    'Extension Add-on'::text
  ]));


-- 5. payments_booking_source_check += 'payment_plan' -------------------------

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_booking_source_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_booking_source_check
  CHECK (booking_source = ANY (ARRAY['admin'::text, 'website'::text, 'payment_plan'::text]));


-- 6. v_ledger_allocation_drift ------------------------------------------------

CREATE OR REPLACE VIEW public.v_ledger_allocation_drift
WITH (security_invoker = on) AS
SELECT
  le.id                                               AS charge_entry_id,
  le.tenant_id,
  le.rental_id,
  le.customer_id,
  le.category,
  le.due_date,
  le.amount,
  le.remaining_amount,
  (le.amount - le.remaining_amount)                   AS settled_amount,
  COALESCE(pa.applied, 0)                             AS applied_amount,
  (le.amount - le.remaining_amount) - COALESCE(pa.applied, 0) AS drift_amount,
  COALESCE(pa.application_count, 0)                   AS application_count
FROM public.ledger_entries le
LEFT JOIN (
  SELECT charge_entry_id,
         SUM(amount_applied) AS applied,
         COUNT(*)            AS application_count
    FROM public.payment_applications
   WHERE charge_entry_id IS NOT NULL
   GROUP BY charge_entry_id
) pa ON pa.charge_entry_id = le.id
WHERE le.type = 'Charge'
  AND (le.amount - le.remaining_amount) <> COALESCE(pa.applied, 0);

COMMENT ON VIEW public.v_ledger_allocation_drift IS
  'Charges whose settled amount (amount - remaining_amount) differs from the sum of their payment_applications. Report only; repairs are per-row and need sign-off. 15 rows on 2026-09-25.';

REVOKE ALL ON public.v_ledger_allocation_drift FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_ledger_allocation_drift TO service_role;


-- 7. ledger_settleable_categories() — the ONE list of what a payment can settle
--
-- Added after slice 1 (Wave 1 fixes, Sep 26 2026). Everything above this
-- section is unchanged.
--
-- The portal marks a charge "no payment can settle this" when its category is
-- missing from the allocator's cat_order. Until now it did so from a copy of
-- the LIVE list hard-coded in the portal — so once this migration is applied
-- the portal would keep calling 'Adjustment', 'Excess Mileage', … unpayable,
-- and before it is applied a portal copied from the new list would call them
-- payable when the live function still cannot reach them. This function is the
-- list, read from the database: it exists exactly when the new
-- payment_apply_fifo_v2 above does, so the portal (payments-model.ts, a GET
-- rpc, never HEAD) reads it when it answers and falls back to the old list
-- when it does not.
--
-- The VALUES below are cat_order's VALUES, verbatim and in the same order. A
-- test (tests/payment-plans/sql/settleable-categories.test.ts) parses
-- payment_apply_fifo_v2's body from the database and requires this function
-- to return exactly its categories, in its priority order — so the two lists
-- cannot drift. Within one priority the order is by name (C collation), which
-- the allocator does not care about (it then orders by due date).
--
-- Read-only and constant: IMMUTABLE (so PostgREST serves it over GET), no
-- table access, no SECURITY DEFINER. Staff and the service role may call it.

CREATE OR REPLACE FUNCTION public.ledger_settleable_categories()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $function$
  SELECT array_agg(cat ORDER BY pri, cat COLLATE "C")
    FROM (
      VALUES
        -- Existing priorities: unchanged.
        ('Rental'::text,            1::numeric),
        ('Tax',                     2),
        ('Service Fee',             3),
        ('Delivery Fee',            4),
        ('Collection Fee',          5),
        ('Insurance',               6),
        ('Extras',                  7),
        ('Extension Rental',        8),
        ('Extension Tax',           9),
        ('Extension Service Fee',  10),
        ('Extension Insurance',    11),
        ('Fine',                   12),
        ('Fines',                  12),
        ('Other',                  13),
        -- Newly visible: after every existing earned category, before the
        -- deposit. See the header for why here.
        ('InitialFee',             13.1),
        ('Initial Fees',           13.1),
        ('Extension',              13.2),
        ('Extension Add-on',       13.2),
        ('Unlimited Mileage',      13.3),
        ('Excess Mileage',         13.3),
        ('Supercharger',           13.3),
        ('Adjustment',             13.4),
        -- Deliberately last: refundable money, not earned money. See header.
        ('Security Deposit',       14)
    ) AS cat_order(cat, pri)
$function$;

COMMENT ON FUNCTION public.ledger_settleable_categories() IS
  'The ledger categories payment_apply_fifo_v2 can settle, in its priority order (its cat_order VALUES). Read by the portal to mark unsettleable charges. A test pins it to the allocator''s body.';

REVOKE ALL ON FUNCTION public.ledger_settleable_categories() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_settleable_categories() TO authenticated, service_role;
