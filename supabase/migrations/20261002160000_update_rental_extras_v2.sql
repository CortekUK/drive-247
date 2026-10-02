-- update_rental_extras_v2 — set a rental's add-ons, and what they cost, while it
-- is still early enough for that to be honest.
--
-- v2 (northwind) only: nothing in v1 calls it. Additive — one new function.
--
-- Guarded by `rental_edit_blocker_v2` (the rental's first four stages — no
-- agreement out, no insurance, no money taken, no handover). Extras are money
-- owed, so in ONE transaction it:
--   1. replaces the rental's `rental_extras_selections` with the given
--      {extra_id, quantity} list, priced from the tenant's OWN catalogue as it
--      stands now (price and billing type snapshotted, as the create flow does —
--      the client never names a price);
--   2. rewrites the latest invoice's `extras_total` and `total_amount`;
--   3. removes the rental's still-unpaid Extras charge (and its reminders) and
--      lets v1's `generate_first_charge_for_rental` raise it again from the
--      invoice — exactly what a freshly created rental would carry.
--
-- per_day extras are multiplied by the hire's days, the create flow's rule:
-- greatest(1, end_date - start_date).

CREATE OR REPLACE FUNCTION public.update_rental_extras_v2(
  p_rental_id uuid,
  p_selections jsonb DEFAULT '[]'::jsonb,
  p_dry_run boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rental  record;
  v_blocker text;
  v_days    integer;
  v_total   numeric := 0;
  v_ids     uuid[];
  v_invoice record;
  v_has_invoice boolean := false;
  s         jsonb;
  e         record;
  q         integer;
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

  v_blocker := rental_edit_blocker_v2(p_rental_id);
  IF v_blocker IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_blocker || ' Its extras are fixed now.');
  END IF;
  IF COALESCE(v_rental.is_pay_as_you_go, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Pay-as-you-go rentals are billed by the day; extras are not added here.');
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  v_days := GREATEST(1, COALESCE(v_rental.end_date - v_rental.start_date, 1));

  -- ── 1. the selections, priced from the tenant's own catalogue ──────────
  DELETE FROM rental_extras_selections WHERE rental_id = p_rental_id;
  FOR s IN SELECT * FROM jsonb_array_elements(COALESCE(p_selections, '[]'::jsonb)) LOOP
    q := COALESCE((s->>'quantity')::integer, 0);
    CONTINUE WHEN q <= 0;
    SELECT id, price, billing_type, max_quantity, is_active INTO e
      FROM rental_extras
     WHERE id = (s->>'extra_id')::uuid AND tenant_id = v_rental.tenant_id;
    IF NOT FOUND OR e.is_active IS FALSE THEN
      RAISE EXCEPTION 'That extra is not in your catalogue.';
    END IF;
    IF e.max_quantity IS NOT NULL AND q > e.max_quantity THEN q := e.max_quantity; END IF;
    INSERT INTO rental_extras_selections (rental_id, extra_id, quantity, price_at_booking, billing_type_at_booking)
    VALUES (p_rental_id, e.id, q, e.price, COALESCE(e.billing_type, 'per_trip'));
    v_total := v_total + q * e.price * (CASE WHEN e.billing_type = 'per_day' THEN v_days ELSE 1 END);
  END LOOP;
  v_total := round(v_total, 2);

  -- ── 2. the invoice ─────────────────────────────────────────────────────
  SELECT * INTO v_invoice FROM invoices
   WHERE rental_id = p_rental_id AND tenant_id = v_rental.tenant_id
   ORDER BY created_at DESC LIMIT 1;
  v_has_invoice := FOUND;
  IF v_has_invoice THEN
    UPDATE invoices SET
      extras_total = v_total,
      total_amount = COALESCE(total_amount, 0) - COALESCE(extras_total, 0) + v_total,
      updated_at   = now()
    WHERE id = v_invoice.id;
  END IF;

  -- ── 3. the Extras charge, out with the old and raised again ───────────
  SELECT array_agg(id) INTO v_ids FROM ledger_entries
   WHERE rental_id = p_rental_id AND tenant_id = v_rental.tenant_id
     AND type = 'Charge' AND category = 'Extras' AND extension_id IS NULL;
  IF v_ids IS NOT NULL THEN
    DELETE FROM reminder_events WHERE charge_id = ANY (v_ids);
    DELETE FROM financial_events WHERE source_table = 'ledger_entries' AND source_id = ANY (v_ids);
    DELETE FROM ledger_entries WHERE id = ANY (v_ids) AND tenant_id = v_rental.tenant_id;
  END IF;
  IF v_has_invoice THEN
    PERFORM generate_first_charge_for_rental(p_rental_id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'extras_total', v_total);
END $$;

REVOKE ALL ON FUNCTION public.update_rental_extras_v2(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_rental_extras_v2(uuid, jsonb, boolean) TO authenticated;
