-- ============================================================================
-- FIFO v2: let a GENERIC payment settle extension charges
-- ============================================================================
-- Bug: payment_apply_fifo_v2 had two extension-isolation clauses:
--   (1) v_extension IS NULL OR le.extension_id = v_extension OR category NOT LIKE 'Extension%'
--   (2) v_extension IS NOT NULL OR category NOT LIKE 'Extension%'
--
-- Clause (2) forbade ANY payment without an extension_id from touching an
-- Extension* charge. So the universal "Collect Payment" button — which creates
-- an untagged generic payment — allocated $0 against a rental whose open
-- balance was extension-only, and the captured Stripe money stranded as
-- status='Credit' (Balance Due never dropped). This is the "Stripe payment not
-- recording on the website" report from globalmotiontransport (rental R-63b168).
--
-- Fix: drop clause (2). Now a generic payment (no extension_id, no targets)
-- waterfalls onto Extension* charges AFTER originals — the cat_order already
-- ranks Rental/Tax/Fees (1-7) ahead of Extension* (8-11), so originals are
-- always paid first. This matches the apply-payment edge function (whose
-- category list already includes Extension*), making the two engines consistent.
--
-- Isolation that still holds (clause 1, unchanged):
--   * An extension-STAMPED payment (v_extension set) can only pay its own
--     extension's charges plus non-extension charges — never another
--     extension's charges.
--   * A category-TARGETED payment still restricts to v_targets.
--
-- Safe for refunds: rental_extension_totals computes per-extension paid_amount
-- from the CHARGE's extension_id (le.amount - le.remaining_amount WHERE
-- le.extension_id = re.id), NOT from the paying payment's extension_id. Which
-- payment settles an extension charge does not change paid/refunded attribution.
-- ============================================================================

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
  v_pay_date DATE;
  v_is_early BOOLEAN;
  v_extension UUID;
  v_targets_jsonb JSONB;
  v_targets TEXT[];
  c RECORD;
  to_apply NUMERIC;
  next_due_date DATE;
BEGIN
  SELECT amount, rental_id, customer_id, vehicle_id, payment_date, is_early, extension_id, target_categories
    INTO v_amt, v_rental, v_customer, v_vehicle, v_pay_date, v_is_early, v_extension, v_targets_jsonb
  FROM payments WHERE id = p_id;

  IF v_customer IS NULL THEN RETURN; END IF;

  -- Convert JSONB array to TEXT[] for filtering. NULL or non-array → v_targets stays NULL.
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
      SELECT 'Fines', 12 UNION ALL
      SELECT 'Other', 13
    )
    SELECT le.id, le.remaining_amount, le.due_date, le.category, co.pri
      FROM ledger_entries le
      JOIN cat_order co ON co.cat = le.category
     WHERE le.customer_id = v_customer
       AND le.type = 'Charge'
       AND le.remaining_amount > 0
       AND (v_rental IS NULL OR le.rental_id = v_rental)
       -- Extension isolation (kept): a payment stamped to extension X may only
       -- pay extension X's charges (plus any non-extension charge). A generic
       -- payment (v_extension IS NULL) may pay any category — clause (2), which
       -- previously blocked generic payments from Extension* charges, is removed
       -- so the universal "Collect Payment" settles extension balances too.
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

    INSERT INTO pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (v_vehicle, c.due_date, 'Revenue', c.category, to_apply, p_id::text || '_' || c.id::text)
    ON CONFLICT (vehicle_id, category, source_ref)
    DO UPDATE SET amount = pnl_entries.amount + EXCLUDED.amount;

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
