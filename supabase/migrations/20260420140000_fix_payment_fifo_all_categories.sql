-- Fix payment_apply_fifo_v2 so it allocates across ALL billable categories,
-- not just category='Rental'. The old version consumed the payment's full
-- remaining into a single Rental charge, starving Tax/Service Fee/Insurance/etc.
-- This left booking-side rentals with "Rental Paid, everything else Not Paid"
-- because the auto_allocate_payments_on_new_charge trigger runs before the
-- apply-payment edge function's category FIFO gets to the non-Rental categories.
--
-- Also make the function idempotent: if the payment was already partly applied
-- (by the edge function), v_left = amount - already_applied — not the full
-- amount. Otherwise double-calls double-update ledger_entries.remaining_amount.

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
  c RECORD;
  to_apply NUMERIC;
  next_due_date DATE;
BEGIN
  SELECT amount, rental_id, customer_id, vehicle_id, payment_date, is_early, extension_id
    INTO v_amt, v_rental, v_customer, v_vehicle, v_pay_date, v_is_early, v_extension
  FROM payments WHERE id = p_id;

  IF v_customer IS NULL THEN
    RETURN;
  END IF;

  -- Idempotency: subtract already-applied so re-runs don't double-consume.
  SELECT COALESCE(SUM(amount_applied), 0) INTO v_already
  FROM payment_applications WHERE payment_id = p_id;

  v_left := v_amt - v_already;
  IF v_left <= 0 THEN
    -- Already fully allocated — finalize status and exit.
    UPDATE payments
       SET status = 'Applied', remaining_amount = 0
     WHERE id = p_id;
    RETURN;
  END IF;

  -- Auto-detect early payment if not explicitly set (Rental charges only).
  IF NOT v_is_early THEN
    SELECT MIN(due_date) INTO next_due_date
    FROM ledger_entries
    WHERE customer_id = v_customer
      AND type = 'Charge'
      AND category = 'Rental'
      AND remaining_amount > 0;

    IF next_due_date IS NOT NULL AND v_pay_date < next_due_date THEN
      v_is_early := TRUE;
      UPDATE payments SET is_early = TRUE WHERE id = p_id;
    END IF;
  END IF;

  -- Allocate to ALL billable categories (not just Rental). Order mirrors the
  -- apply-payment edge function so both allocators are consistent:
  --   Rental → Tax → Service Fee → Delivery Fee → Collection Fee → Insurance → Extras →
  --   Extension Rental → Extension Tax → Extension Service Fee → Extension Insurance →
  --   Fines → Other
  -- Security Deposit is deliberately excluded — deposits are Stripe pre-auth
  -- holds now, not ledger charges.
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
       -- Extension isolation: if payment is tagged to a specific extension,
       -- only consume charges from that extension's Extension* categories.
       AND (v_extension IS NULL OR le.extension_id = v_extension OR NOT le.category LIKE 'Extension%')
       AND (v_extension IS NOT NULL OR NOT le.category LIKE 'Extension%')
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

    -- Book revenue on the charge due date (even future) with conflict handling.
    INSERT INTO pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (v_vehicle, c.due_date, 'Revenue', c.category, to_apply, p_id::text)
    ON CONFLICT (vehicle_id, category, source_ref)
    DO UPDATE SET amount = pnl_entries.amount + EXCLUDED.amount;

    v_left := v_left - to_apply;
  END LOOP;

  -- Finalize payment status.
  IF v_left <= 0 THEN
    UPDATE payments SET status = 'Applied', remaining_amount = 0 WHERE id = p_id;
  ELSIF v_left = v_amt THEN
    UPDATE payments SET status = 'Credit', remaining_amount = v_left WHERE id = p_id;
  ELSE
    UPDATE payments SET status = 'Partial', remaining_amount = v_left WHERE id = p_id;
  END IF;
END;
$function$;

-- The auto_allocate_payments_on_new_charge trigger remains, but now it's safe:
-- with the idempotent + multi-category v2, re-runs are no-ops and the trigger
-- no longer starves non-Rental categories. The only remaining gotcha is the
-- trigger's inner filter (NEW.category='Rental') which means it still only
-- fires on Rental charge inserts — but once it fires, the function handles
-- all outstanding categories for that customer, not just Rental.

COMMENT ON FUNCTION public.payment_apply_fifo_v2(uuid)
  IS 'FIFO allocator across all billable categories (Rental, Tax, Service Fee, Delivery Fee, Collection Fee, Insurance, Extras, Extension*, Fines, Other). Idempotent: re-runs apply only the remaining unapplied amount. Skips Security Deposit (handled as Stripe pre-auth hold).';
