-- QA R2 (2026-11-13): portal-made rentals never charged tax, the service fee
-- or extras, because they had no invoice. APPLIED to production 2026-11-13.
-- Rollback: re-run 20261002140000_update_rental_terms_v2.sql and the live
-- update_rental_extras_v2 definition (both are the bodies below without the
-- ensure_rental_invoice_v2 branches), then DROP FUNCTION ensure_rental_invoice_v2.

-- A rental's invoice, raised when it has none (QA R2.9 / R2.10, 2026-11-13).
--
-- generate_first_charge_for_rental splits a rental's charges (Rental, Tax,
-- Service Fee, Extras ...) from its invoice, and falls back to ONE Rental
-- charge when there is no invoice. The booking site writes an invoice; a
-- rental made in the v2 portal (New Rental -> draft -> stages) never did, so
-- its tax, service fee and extras were never charged. update_rental_terms_v2
-- and update_rental_extras_v2 now call this when the invoice is missing.
--
-- Tax and service fee: the caller's figures when given (the When & where
-- stage works them out exactly as the screen shows them), otherwise the
-- tenant's settings on the rental price less any discount, the same rule.
-- Internal only: no grant to anon/authenticated; the two SECURITY DEFINER
-- RPCs above call it after their own tenant/role checks.
CREATE OR REPLACE FUNCTION public.ensure_rental_invoice_v2(
  p_rental_id uuid,
  p_tax numeric DEFAULT NULL,
  p_service numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id      uuid;
  v_rental  record;
  v_t       record;
  v_sub     numeric;
  v_tax     numeric;
  v_svc     numeric;
BEGIN
  SELECT id INTO v_id FROM invoices WHERE rental_id = p_rental_id ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  SELECT * INTO v_rental FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND OR v_rental.customer_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT tax_enabled, tax_percentage, service_fee_enabled, service_fee_type, service_fee_value, service_fee_amount
    INTO v_t FROM tenants WHERE id = v_rental.tenant_id;

  v_sub := round(COALESCE(v_rental.monthly_amount, 0) - COALESCE(v_rental.discount_applied, 0), 2);
  v_tax := COALESCE(p_tax,
    CASE WHEN v_t.tax_enabled AND COALESCE(v_t.tax_percentage, 0) > 0
         THEN round(v_sub * v_t.tax_percentage / 100, 2) ELSE 0 END);
  v_svc := COALESCE(p_service,
    CASE WHEN v_t.service_fee_enabled THEN
      CASE WHEN v_t.service_fee_type = 'percentage'
           THEN round(v_sub * COALESCE(v_t.service_fee_value, v_t.service_fee_amount, 0) / 100, 2)
           ELSE COALESCE(v_t.service_fee_value, v_t.service_fee_amount, 0) END
    ELSE 0 END);

  INSERT INTO invoices (
    rental_id, customer_id, vehicle_id, tenant_id, invoice_number, invoice_date, due_date,
    subtotal, rental_fee, tax_amount, service_fee, delivery_fee, extras_total, total_amount, invoice_type
  ) VALUES (
    p_rental_id, v_rental.customer_id, v_rental.vehicle_id, v_rental.tenant_id,
    'INV-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || p_rental_id::text), 1, 6)),
    current_date, v_rental.start_date,
    v_sub, v_sub, v_tax, v_svc, COALESCE(v_rental.delivery_fee, 0), 0,
    v_sub + v_tax + v_svc + COALESCE(v_rental.delivery_fee, 0) + COALESCE(v_rental.collection_fee, 0),
    'rental'
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.ensure_rental_invoice_v2(uuid, numeric, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_rental_invoice_v2(uuid, numeric, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.update_rental_terms_v2(p_rental_id uuid, p_terms jsonb DEFAULT '{}'::jsonb, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rental   record;
  v_blocker  text;
  v_invoice  record;
  v_ids      uuid[];
  v_start    date;
  v_end      date;
  v_subtotal numeric;
  v_total    numeric;
BEGIN
  SELECT * INTO v_rental FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'This rental does not exist.');
  END IF;

  -- Who is asking. Another tenant's rental reads as "does not exist".
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
    RETURN jsonb_build_object('ok', false, 'reason', v_blocker || ' Its dates, handover and price are fixed now.');
  END IF;
  IF COALESCE(v_rental.is_pay_as_you_go, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Pay-as-you-go rentals are billed by the day, not re-priced here.');
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- ── the new terms ──────────────────────────────────────────────────────
  v_start := COALESCE((p_terms->>'start_date')::date, v_rental.start_date);
  v_end   := CASE WHEN p_terms ? 'end_date' THEN (p_terms->>'end_date')::date ELSE v_rental.end_date END;
  IF v_end IS NOT NULL AND v_end <= v_start THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'The return has to be after the pickup.');
  END IF;

  -- The charges about to be replaced: the rental's first, un-extended ones.
  SELECT array_agg(id) INTO v_ids
    FROM ledger_entries
   WHERE rental_id = p_rental_id AND tenant_id = v_rental.tenant_id
     AND type = 'Charge' AND extension_id IS NULL
     AND category IN ('Rental', 'Tax', 'Service Fee', 'Delivery Fee', 'Collection Fee');

  IF EXISTS (
    SELECT 1 FROM financial_events fe
      JOIN financial_event_sync_state s ON s.financial_event_id = fe.id
     WHERE fe.source_table = 'ledger_entries' AND fe.source_id = ANY (COALESCE(v_ids, '{}'))
       AND (s.synced_at IS NOT NULL OR s.external_invoice_id IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason',
      'These charges are already in your accounting software, so they cannot be re-priced here.');
  END IF;

  BEGIN
    UPDATE rentals SET
      start_date            = v_start,
      end_date              = v_end,
      pickup_time           = CASE WHEN p_terms ? 'pickup_time' THEN NULLIF(p_terms->>'pickup_time', '')::time ELSE pickup_time END,
      return_time           = CASE WHEN p_terms ? 'return_time' THEN NULLIF(p_terms->>'return_time', '')::time ELSE return_time END,
      delivery_option       = CASE WHEN p_terms ? 'delivery_option' THEN p_terms->>'delivery_option' ELSE delivery_option END,
      pickup_location       = CASE WHEN p_terms ? 'pickup_location' THEN NULLIF(p_terms->>'pickup_location', '') ELSE pickup_location END,
      return_location       = CASE WHEN p_terms ? 'return_location' THEN NULLIF(p_terms->>'return_location', '') ELSE return_location END,
      pickup_location_id    = CASE WHEN p_terms ? 'pickup_location_id' THEN NULLIF(p_terms->>'pickup_location_id', '')::uuid ELSE pickup_location_id END,
      return_location_id    = CASE WHEN p_terms ? 'return_location_id' THEN NULLIF(p_terms->>'return_location_id', '')::uuid ELSE return_location_id END,
      uses_delivery_service = CASE WHEN p_terms ? 'uses_delivery_service' THEN (p_terms->>'uses_delivery_service')::boolean ELSE uses_delivery_service END,
      delivery_fee          = CASE WHEN p_terms ? 'delivery_fee' THEN NULLIF((p_terms->>'delivery_fee')::numeric, 0) ELSE delivery_fee END,
      collection_fee        = CASE WHEN p_terms ? 'collection_fee' THEN NULLIF((p_terms->>'collection_fee')::numeric, 0) ELSE collection_fee END,
      monthly_amount        = CASE WHEN p_terms ? 'monthly_amount' THEN (p_terms->>'monthly_amount')::numeric ELSE monthly_amount END,
      updated_at            = now()
    WHERE id = p_rental_id AND tenant_id = v_rental.tenant_id;
  EXCEPTION WHEN OTHERS THEN
    -- prevent_rental_overlap raises when the car is booked for the new dates.
    IF SQLERRM ILIKE '%overlap%' OR SQLERRM ILIKE '%already booked%' OR SQLERRM ILIKE '%conflict%' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'The car is already booked for some of those dates.');
    END IF;
    RAISE;
  END;

  SELECT * INTO v_rental FROM rentals WHERE id = p_rental_id;
  v_subtotal := COALESCE(v_rental.monthly_amount, 0) - COALESCE(v_rental.discount_applied, 0);

  -- ── the invoice, rewritten to the new figures ─────────────────────────
  SELECT * INTO v_invoice FROM invoices
   WHERE rental_id = p_rental_id AND tenant_id = v_rental.tenant_id
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    v_total := v_subtotal
             + COALESCE((p_terms->>'tax_amount')::numeric, v_invoice.tax_amount, 0)
             + COALESCE((p_terms->>'service_fee')::numeric, v_invoice.service_fee, 0)
             + COALESCE(v_invoice.insurance_premium, 0)
             + COALESCE(v_rental.delivery_fee, 0)
             + COALESCE(v_rental.collection_fee, 0)
             + COALESCE(v_invoice.extras_total, 0)
             + COALESCE(v_invoice.security_deposit, 0);
    UPDATE invoices SET
      subtotal     = v_subtotal,
      rental_fee   = v_subtotal,
      tax_amount   = COALESCE((p_terms->>'tax_amount')::numeric, tax_amount),
      service_fee  = COALESCE((p_terms->>'service_fee')::numeric, service_fee),
      delivery_fee = COALESCE(v_rental.delivery_fee, 0),
      total_amount = v_total,
      due_date     = v_start,
      updated_at   = now()
    WHERE id = v_invoice.id;
  ELSE
    -- A rental made in the portal has no invoice yet, and without one the
    -- charges below fall back to a single Rental line: tax and the service
    -- fee were never charged (QA R2.10). Raise the invoice from these terms.
    PERFORM ensure_rental_invoice_v2(p_rental_id, (p_terms->>'tax_amount')::numeric, (p_terms->>'service_fee')::numeric);
  END IF;

  -- ── the charges: out with the old, regenerated from the invoice ───────
  IF v_ids IS NOT NULL THEN
    DELETE FROM reminder_events WHERE charge_id = ANY (v_ids);
    DELETE FROM financial_events WHERE source_table = 'ledger_entries' AND source_id = ANY (v_ids);
    DELETE FROM ledger_entries WHERE id = ANY (v_ids) AND tenant_id = v_rental.tenant_id;
  END IF;
  PERFORM generate_first_charge_for_rental(p_rental_id);

  RETURN jsonb_build_object(
    'ok', true,
    'total', (SELECT COALESCE(sum(amount), 0) FROM ledger_entries
               WHERE rental_id = p_rental_id AND type = 'Charge' AND extension_id IS NULL)
  );
END $function$;

CREATE OR REPLACE FUNCTION public.update_rental_extras_v2(p_rental_id uuid, p_selections jsonb DEFAULT '[]'::jsonb, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_price   numeric;
  v_booked  jsonb;
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
  -- What each extra was booked at, so a per-car extra whose car price has
  -- since been removed keeps its booked price instead of falling to 0.
  SELECT COALESCE(jsonb_object_agg(extra_id::text, price_at_booking), '{}'::jsonb) INTO v_booked
    FROM rental_extras_selections WHERE rental_id = p_rental_id;
  DELETE FROM rental_extras_selections WHERE rental_id = p_rental_id;
  FOR s IN SELECT * FROM jsonb_array_elements(COALESCE(p_selections, '[]'::jsonb)) LOOP
    q := COALESCE((s->>'quantity')::integer, 0);
    CONTINUE WHEN q <= 0;
    SELECT id, name, price, pricing_type, billing_type, max_quantity, is_active INTO e
      FROM rental_extras
     WHERE id = (s->>'extra_id')::uuid AND tenant_id = v_rental.tenant_id;
    IF NOT FOUND OR e.is_active IS FALSE THEN
      RAISE EXCEPTION 'That extra is not in your catalogue.';
    END IF;
    IF e.max_quantity IS NOT NULL AND q > e.max_quantity THEN q := e.max_quantity; END IF;
    -- A per-car extra costs its price for THIS rental's car (rental_extras.price
    -- is a 0 placeholder for it), the way the booking site prices it.
    v_price := e.price;
    IF e.pricing_type = 'per_vehicle' THEN
      SELECT vp.price INTO v_price FROM rental_extras_vehicle_pricing vp
       WHERE vp.extra_id = e.id AND vp.vehicle_id = v_rental.vehicle_id;
      IF NOT FOUND THEN
        IF v_booked ? e.id::text THEN
          v_price := (v_booked ->> e.id::text)::numeric;
        ELSE
          RAISE EXCEPTION '% has no price for this car. Set one in Settings, Extras.', e.name;
        END IF;
      END IF;
    END IF;
    INSERT INTO rental_extras_selections (rental_id, extra_id, quantity, price_at_booking, billing_type_at_booking)
    VALUES (p_rental_id, e.id, q, v_price, COALESCE(e.billing_type, 'per_trip'));
    v_total := v_total + q * v_price * (CASE WHEN e.billing_type = 'per_day' THEN v_days ELSE 1 END);
  END LOOP;
  v_total := round(v_total, 2);

  -- ── 2. the invoice ─────────────────────────────────────────────────────
  SELECT * INTO v_invoice FROM invoices
   WHERE rental_id = p_rental_id AND tenant_id = v_rental.tenant_id
   ORDER BY created_at DESC LIMIT 1;
  v_has_invoice := FOUND;
  IF NOT v_has_invoice THEN
    -- No invoice yet (a rental made in the portal): without one the Extras
    -- charge below was never raised, so an extra never reached the total
    -- (QA R2.9). Raise the invoice, then carry on as if it had been there.
    PERFORM ensure_rental_invoice_v2(p_rental_id);
    SELECT * INTO v_invoice FROM invoices
     WHERE rental_id = p_rental_id AND tenant_id = v_rental.tenant_id
     ORDER BY created_at DESC LIMIT 1;
    v_has_invoice := FOUND;
  END IF;
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
END $function$;
