-- APPLIED to production 2026-11-13 (R5.6 QA, branch Rental_testing-13nov)
--
-- update_rental_terms_v2 rebuilt the invoice's rental fee from
-- rentals.monthly_amount on EVERY save. Booking-site rentals store the grand
-- total there (rental + tax + service fee), so saving only a time, place or
-- delivery choice on the When & where stage re-charged tax and fee inside the
-- Rental line: R-07203d went $185 -> $235 for a $15 delivery fee (expected $200).
-- Now, when the save does not re-price (no monthly_amount in p_terms), the
-- invoice's own rental_fee is kept. Re-pricing saves are unchanged.
--
-- Rollback: re-run 20261002140000_update_rental_terms_v2.sql's body as it was
-- live before this (v_subtotal from monthly_amount unconditionally).

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
  v_has_inv  boolean;
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

  -- ── the invoice, rewritten to the new figures ─────────────────────────
  SELECT * INTO v_invoice FROM invoices
   WHERE rental_id = p_rental_id AND tenant_id = v_rental.tenant_id
   ORDER BY created_at DESC LIMIT 1;
  v_has_inv := FOUND;
  -- Not re-priced (no monthly_amount): the rental price stays the invoice's.
  -- Booking-site rentals keep the GRAND total in rentals.monthly_amount, so
  -- reading it here turned a $150 rental into $185 plus tax and fee again.
  v_subtotal := CASE
    WHEN NOT (p_terms ? 'monthly_amount') AND v_has_inv AND v_invoice.rental_fee IS NOT NULL
      THEN v_invoice.rental_fee
    ELSE COALESCE(v_rental.monthly_amount, 0) - COALESCE(v_rental.discount_applied, 0)
  END;
  IF v_has_inv THEN
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
