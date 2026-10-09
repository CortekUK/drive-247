-- APPLIED to production 2026-10-09
--
-- Payments settled only by payment_apply_fifo_v2 (the auto_fifo_on_payment_*
-- triggers and recover-pending-stripe-payments) were allocated to charges but
-- never got a 'Payment' ledger line — apply-payment is the only place that
-- wrote one. Anything summing the ledger (rental Balance tile, rental-balance
-- hook) then showed already-paid weeks as owed (RevTek / Keri Austin: one
-- $333.84 week). payment_apply_fifo_v2 now writes the line itself, idempotent
-- on the payment_id unique index, and existing payments are backfilled.
--
-- Backfill skips: uncaptured holds (capture_status = 'requires_capture'),
-- payments whose allocations don't add up, and the 'Test' tenant (Zoho sync).

BEGIN;

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
  v_status TEXT;
  v_capture TEXT;
  v_ptype TEXT;
  v_ledger_cat TEXT;
  v_ledger_date DATE;
  v_ledger_ref TEXT;
  c RECORD;
  to_apply NUMERIC;
  next_due_date DATE;
BEGIN
  SELECT amount, rental_id, customer_id, vehicle_id, payment_date, is_early, extension_id, target_categories, tenant_id,
         status, capture_status, payment_type
    INTO v_amt, v_rental, v_customer, v_vehicle, v_pay_date, v_is_early, v_extension, v_targets_jsonb, v_tenant,
         v_status, v_capture, v_ptype
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

  -- Record the payment itself in the ledger, exactly as apply-payment does.
  -- Payments settled only through this function (the auto_fifo_on_payment_*
  -- triggers, recover-pending-stripe-payments) used to get their
  -- payment_applications but no 'Payment' ledger line, so anything that sums
  -- the ledger (rental Balance tile) showed those weeks as still owed.
  -- Captured money only: an uncaptured hold is not a payment yet.
  IF v_status IN ('Completed', 'Applied', 'Partial', 'Credit')
     AND v_capture IS DISTINCT FROM 'requires_capture'
     AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE payment_id = p_id) THEN
    v_ledger_date := COALESCE(v_pay_date, CURRENT_DATE);
    v_ledger_cat := CASE
      WHEN cardinality(v_targets) = 1 THEN v_targets[1]
      WHEN v_ptype = 'InitialFee' THEN 'InitialFee'
      WHEN v_ptype = 'Fine' THEN 'Fines'
      WHEN COALESCE(v_ptype, 'Payment') = 'Payment' THEN 'Rental'
      ELSE 'Other'
    END;
    -- ux_rental_charge_unique also covers Payment lines, so a second payment on
    -- the same rental/day/category needs a reference to be distinct.
    IF EXISTS (SELECT 1 FROM ledger_entries
                WHERE rental_id = v_rental AND due_date = v_ledger_date AND type = 'Payment'
                  AND category = v_ledger_cat AND extension_id IS NULL AND reference IS NULL) THEN
      v_ledger_ref := 'Payment ' || upper(left(p_id::text, 8));
    END IF;
    INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, tenant_id, entry_date, due_date,
                               type, category, amount, remaining_amount, payment_id, reference)
    VALUES (v_customer, v_rental, v_vehicle, v_tenant, v_ledger_date, v_ledger_date,
            'Payment', v_ledger_cat, -ABS(v_amt), 0, p_id, v_ledger_ref)
    ON CONFLICT DO NOTHING;
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
    WITH cat_order AS (
      SELECT 'Rental'::text AS cat, 1 AS pri UNION ALL
      SELECT 'Tax', 2 UNION ALL
      SELECT 'Service Fee', 3 UNION ALL
      SELECT 'Delivery Fee', 4 UNION ALL
      SELECT 'Collection Fee', 5 UNION ALL
      SELECT 'Insurance', 6 UNION ALL
      SELECT 'Extras', 7 UNION ALL
      SELECT 'Extension Rental', 8 UNION ALL
      SELECT 'Extension Tax', 9 UNION ALL
      SELECT 'Extension Service Fee', 10 UNION ALL
      SELECT 'Extension Insurance', 11 UNION ALL
      SELECT 'Fine', 12 UNION ALL
      SELECT 'Fines', 12 UNION ALL
      SELECT 'Other', 13 UNION ALL
      -- Deliberately last: refundable money, not earned money. See header.
      SELECT 'Security Deposit', 14
    )
    SELECT le.id, le.remaining_amount, le.due_date, le.category, co.pri
      FROM ledger_entries le
      JOIN cat_order co ON co.cat = le.category
     WHERE le.customer_id = v_customer
       AND le.type = 'Charge'
       AND le.remaining_amount > 0
       AND (v_rental IS NULL OR le.rental_id = v_rental)
       AND (v_extension IS NULL OR le.extension_id = v_extension OR le.category NOT LIKE 'Extension%')
       AND (v_targets IS NULL OR cardinality(v_targets) = 0 OR le.category = ANY(v_targets))
     ORDER BY co.pri ASC, le.due_date ASC, le.entry_date ASC, le.id ASC
  LOOP
    EXIT WHEN v_left <= 0;
    to_apply := LEAST(c.remaining_amount, v_left);

    INSERT INTO payment_applications(payment_id, charge_entry_id, amount_applied)
    VALUES (p_id, c.id, to_apply)
    ON CONFLICT ON CONSTRAINT ux_payment_app_unique DO NOTHING;

    UPDATE ledger_entries
       SET remaining_amount = remaining_amount - to_apply
     WHERE id = c.id;

    -- A security deposit is a LIABILITY, not revenue: it is the renter's money
    -- held against damage, refundable in full or in part at the end of the
    -- rental. Booking it as Revenue overstates earnings now and would need a
    -- negative correction at refund time. chk_pnl_category_valid ALLOWS
    -- 'Security Deposit', so nothing but this guard stops it. The ledger is the
    -- sole record of deposits; P&L sees them only if they are forfeited, which
    -- is recorded separately as a Fine/Other charge.
    IF c.category <> 'Security Deposit' THEN
      -- P&L keeps fine revenue under 'Fines' (plural) to match existing pnl_entries
      -- data and the chk_pnl_category_valid constraint, even though the ledger
      -- charge category is 'Fine' (singular). Only the display name is normalized;
      -- the amount/allocation is unchanged.
      INSERT INTO pnl_entries(vehicle_id, tenant_id, entry_date, side, category, amount, source_ref)
      VALUES (v_vehicle, v_tenant, c.due_date, 'Revenue',
              CASE WHEN c.category = 'Fine' THEN 'Fines' ELSE c.category END,
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
$function$

;

INSERT INTO public.ledger_entries
  (customer_id, rental_id, vehicle_id, tenant_id, entry_date, due_date, type, category, amount, remaining_amount, payment_id, reference)
SELECT p.customer_id, p.rental_id, p.vehicle_id, p.tenant_id,
       COALESCE(p.payment_date, p.created_at::date) AS entry_date,
       COALESCE(p.payment_date, p.created_at::date) AS due_date,
       'Payment' AS type,
       CASE
         WHEN jsonb_typeof(p.target_categories) = 'array' AND jsonb_array_length(p.target_categories) = 1
           THEN p.target_categories->>0
         WHEN p.payment_type = 'InitialFee' THEN 'InitialFee'
         WHEN p.payment_type = 'Fine' THEN 'Fines'
         WHEN COALESCE(p.payment_type, 'Payment') = 'Payment' THEN 'Rental'
         ELSE 'Other'
       END AS category,
       -ABS(p.amount) AS amount, 0 AS remaining_amount, p.id AS payment_id,
       'Payment ' || upper(left(p.id::text, 8)) AS reference
  FROM payments p
  JOIN tenants t ON t.id = p.tenant_id
 WHERE p.status IN ('Applied', 'Partial', 'Credit')
   AND p.capture_status IS DISTINCT FROM 'requires_capture'
   AND p.customer_id IS NOT NULL
   AND t.company_name <> 'Test'
   AND NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.payment_id = p.id)
   -- only rows whose allocations already add up (amount = applied + remaining)
   AND ABS(p.amount - COALESCE(p.remaining_amount, 0)
           - COALESCE((SELECT SUM(a.amount_applied) FROM payment_applications a WHERE a.payment_id = p.id), 0)) <= 0.01
;

COMMIT;
