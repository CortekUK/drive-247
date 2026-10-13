-- update_rental_extras_v1 — add or remove a rental's add-ons any time before
-- the car is handed over, including after the agreement has gone out and
-- after money has been taken.
--
-- v1 rental detail ("Edit add-ons"). Additive — one new function, no schema
-- change. v2's `update_rental_extras_v2` stays as it is (pre-agreement only).
--
-- Unlike v2, the rental's money may already be partly or fully paid, so the
-- Extras charge is ADJUSTED rather than deleted and re-raised. Payment
-- applications are never touched. In ONE transaction it:
--   1. replaces `rental_extras_selections`, priced from the tenant's OWN
--      catalogue as it stands now — EXCEPT an extra the rental already had at
--      the same billing type, which keeps the price it was booked at, so
--      removing one add-on never re-prices the others;
--   2. rewrites the latest invoice's `extras_total` and `total_amount`;
--   3. moves the rental's Extras charge by the difference:
--        • more add-ons  → the charge grows; the extra is owed (unpaid);
--        • fewer add-ons → the unpaid part shrinks first; anything the renter
--          already PAID for removed add-ons is returned as `refund_due` for
--          the operator to refund through the normal Refund flow (no money
--          moves automatically).
--      "What the charge stands at" is the Extras charges less Extras refunds
--      already issued, so a refund taken earlier is never billed again.
--
-- Refuses: closed/cancelled rentals, a car already handed over, pay-as-you-go,
-- installment plans (the schedule was built from the old total), and charges
-- already synced to an accounting provider.

CREATE OR REPLACE FUNCTION public.update_rental_extras_v1(
  p_rental_id uuid,
  p_selections jsonb DEFAULT '[]'::jsonb,
  p_dry_run boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rental    record;
  v_days      integer;
  v_new       numeric := 0;
  v_current   numeric := 0;
  v_delta     numeric;
  v_left      numeric;
  v_take      numeric;
  v_refund    numeric := 0;
  v_ids       uuid[];
  v_invoice   record;
  v_has_invoice boolean := false;
  v_old       jsonb;
  s           jsonb;
  e           record;
  c           record;
  q           integer;
  v_price     numeric;
  v_billing   text;
BEGIN
  SELECT * INTO v_rental FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'This rental does not exist.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM app_users u
     WHERE u.auth_user_id = auth.uid()
       AND COALESCE(u.is_active, true)
       AND (u.is_super_admin IS TRUE
            OR (u.tenant_id = v_rental.tenant_id AND COALESCE(u.role, '') <> 'viewer'))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'This rental does not exist.');
  END IF;

  IF lower(COALESCE(v_rental.status, '')) IN ('closed', 'completed', 'cancelled', 'canceled', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'reason',
      'This rental is ' || lower(v_rental.status) || ', so its add-ons can no longer be changed.');
  END IF;
  IF EXISTS (SELECT 1 FROM rental_key_handovers k WHERE k.rental_id = p_rental_id AND k.handed_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason',
      'The car has already been handed over, so its add-ons can no longer be changed.');
  END IF;
  IF COALESCE(v_rental.is_pay_as_you_go, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason',
      'Pay-as-you-go rentals are billed by the day; add-ons are not changed here.');
  END IF;
  IF EXISTS (SELECT 1 FROM installment_plans ip WHERE ip.rental_id = p_rental_id
               AND lower(COALESCE(ip.status, '')) NOT IN ('cancelled', 'canceled')) THEN
    RETURN jsonb_build_object('ok', false, 'reason',
      'This rental is on an installment plan built from its current total, so its add-ons cannot be changed here.');
  END IF;

  SELECT array_agg(id) INTO v_ids FROM ledger_entries
   WHERE rental_id = p_rental_id AND tenant_id = v_rental.tenant_id
     AND type = 'Charge' AND category = 'Extras' AND extension_id IS NULL;

  IF EXISTS (
    SELECT 1 FROM financial_events fe
      JOIN financial_event_sync_state s2 ON s2.financial_event_id = fe.id
     WHERE fe.source_table = 'ledger_entries' AND fe.source_id = ANY (COALESCE(v_ids, '{}'))
       AND (s2.synced_at IS NOT NULL OR s2.external_invoice_id IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason',
      'The add-ons charge is already in your accounting software, so it cannot be changed here.');
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  v_days := GREATEST(1, COALESCE(v_rental.end_date - v_rental.start_date, 1));

  -- ── 1. the selections ──────────────────────────────────────────────────
  SELECT COALESCE(jsonb_object_agg(extra_id::text,
           jsonb_build_object('price', price_at_booking, 'billing', billing_type_at_booking)), '{}'::jsonb)
    INTO v_old
    FROM rental_extras_selections WHERE rental_id = p_rental_id;

  DELETE FROM rental_extras_selections WHERE rental_id = p_rental_id;
  FOR s IN SELECT * FROM jsonb_array_elements(COALESCE(p_selections, '[]'::jsonb)) LOOP
    q := COALESCE((s->>'quantity')::integer, 0);
    CONTINUE WHEN q <= 0;
    SELECT id, price, billing_type, max_quantity, is_active INTO e
      FROM rental_extras
     WHERE id = (s->>'extra_id')::uuid AND tenant_id = v_rental.tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That add-on is not in your catalogue.';
    END IF;
    IF v_old ? e.id::text THEN
      -- Already on the rental: keep what it was booked at.
      v_price   := (v_old->e.id::text->>'price')::numeric;
      v_billing := COALESCE(v_old->e.id::text->>'billing', e.billing_type, 'per_trip');
    ELSE
      IF e.is_active IS FALSE THEN
        RAISE EXCEPTION 'That add-on is switched off in your catalogue.';
      END IF;
      v_price   := e.price;
      v_billing := COALESCE(e.billing_type, 'per_trip');
    END IF;
    IF e.max_quantity IS NOT NULL AND q > e.max_quantity THEN q := e.max_quantity; END IF;
    INSERT INTO rental_extras_selections (rental_id, extra_id, quantity, price_at_booking, billing_type_at_booking)
    VALUES (p_rental_id, e.id, q, v_price, v_billing);
    v_new := v_new + q * v_price * (CASE WHEN v_billing = 'per_day' THEN v_days ELSE 1 END);
  END LOOP;
  v_new := round(v_new, 2);

  -- ── 2. the invoice ─────────────────────────────────────────────────────
  SELECT * INTO v_invoice FROM invoices
   WHERE rental_id = p_rental_id AND tenant_id = v_rental.tenant_id
   ORDER BY created_at DESC LIMIT 1;
  v_has_invoice := FOUND;
  IF v_has_invoice THEN
    UPDATE invoices SET
      extras_total = v_new,
      total_amount = COALESCE(total_amount, 0) - COALESCE(extras_total, 0) + v_new,
      updated_at   = now()
    WHERE id = v_invoice.id;
  END IF;

  -- ── 3. the Extras charge ───────────────────────────────────────────────
  -- What the renter is currently billed for add-ons: charges less refunds.
  SELECT COALESCE(SUM(amount), 0) INTO v_current FROM ledger_entries
   WHERE rental_id = p_rental_id AND tenant_id = v_rental.tenant_id
     AND category = 'Extras' AND extension_id IS NULL AND type IN ('Charge', 'Refund');
  v_delta := round(v_new - v_current, 2);

  IF v_delta > 0 THEN
    SELECT id INTO c FROM ledger_entries
     WHERE id = ANY (COALESCE(v_ids, '{}'))
     ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      UPDATE ledger_entries
         SET amount = amount + v_delta, remaining_amount = remaining_amount + v_delta
       WHERE id = c.id;
    ELSE
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category,
                                 amount, due_date, remaining_amount, tenant_id)
      VALUES (v_rental.customer_id, p_rental_id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Extras',
              v_delta, v_rental.start_date, v_delta, v_rental.tenant_id);
    END IF;

  ELSIF v_delta < 0 THEN
    v_left := -v_delta;
    -- Take the removed add-ons off what is still unpaid, newest charge first.
    FOR c IN
      SELECT id, amount, remaining_amount FROM ledger_entries
       WHERE id = ANY (COALESCE(v_ids, '{}')) AND remaining_amount > 0
       ORDER BY created_at DESC
    LOOP
      EXIT WHEN v_left <= 0;
      v_take := LEAST(c.remaining_amount, v_left);
      IF v_take >= c.amount
         AND NOT EXISTS (SELECT 1 FROM payment_applications pa WHERE pa.charge_entry_id = c.id) THEN
        -- Wholly unpaid and wholly removed: drop the charge.
        DELETE FROM reminder_events WHERE charge_id = c.id;
        DELETE FROM financial_events WHERE source_table = 'ledger_entries' AND source_id = c.id;
        DELETE FROM ledger_entries WHERE id = c.id;
      ELSE
        UPDATE ledger_entries
           SET amount = amount - v_take, remaining_amount = remaining_amount - v_take
         WHERE id = c.id;
      END IF;
      v_left := v_left - v_take;
    END LOOP;
    -- Whatever is left was already paid: it is owed back to the renter.
    v_refund := round(GREATEST(v_left, 0), 2);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'extras_total', v_new,
    'previous_total', v_current,
    'added_owed', GREATEST(v_delta, 0),
    'refund_due', v_refund
  );
END $$;

REVOKE ALL ON FUNCTION public.update_rental_extras_v1(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_rental_extras_v1(uuid, jsonb, boolean) TO authenticated;
