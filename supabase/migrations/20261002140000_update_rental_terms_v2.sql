-- update_rental_terms_v2 — change a rental's WHEN, HOW and WHERE, and re-price
-- it, while it is still early enough for that to be honest.
--
-- v2 (northwind) only: nothing in v1 calls it. Additive — two new functions,
-- no schema change (V2_PLAN §4).
--
-- WHEN IT IS ALLOWED (Ghulam, 2026-10-02): only while the rental has not moved
-- past its first four stages — the same rule `change_rental_customer_v2` keeps,
-- written here as `rental_edit_blocker_v2` so later stages can share it.
--
-- WHAT IT DOES, in one transaction:
--   1. writes the new dates, times, pickup/return method, places and fees, and
--      the new rental price (monthly_amount) onto the rental;
--   2. rewrites the rental's latest invoice to the new figures;
--   3. removes the rental's still-unpaid first charges (Rental, Tax, Service
--      Fee, Delivery Fee, Collection Fee) — with their charge reminders and
--      their accounting events — and regenerates them from the invoice with
--      v1's own `generate_first_charge_for_rental`, so the new charges are
--      exactly what a freshly created rental would carry.
--
-- The amounts are computed by the portal with the same pricing engine and the
-- same tax / service-fee rules the create flow uses, and passed in. The guard
-- guarantees no money has been taken, so every charge removed is still owed
-- in full and nothing has been allocated against it.
--
-- REFUSES when any of those charges has already been synced to an accounting
-- provider: deleting a synced invoice line here would leave the books saying
-- something the ledger no longer does.

CREATE OR REPLACE FUNCTION public.rental_edit_blocker_v2(p_rental_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
BEGIN
  SELECT status, insurance_status, docusign_envelope_id, signed_document_id
    INTO v FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN RETURN 'This rental does not exist.'; END IF;

  RETURN CASE
    WHEN lower(COALESCE(v.status, '')) <> 'pending'
      THEN 'Only a pending rental can be changed here. This one is ' || COALESCE(v.status, 'without a status') || '.'
    WHEN v.docusign_envelope_id IS NOT NULL OR v.signed_document_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM rental_agreements a WHERE a.rental_id = p_rental_id
                   AND (a.envelope_sent_at IS NOT NULL OR a.signed_document_id IS NOT NULL))
      THEN 'The agreement has already gone out.'
    WHEN lower(COALESCE(v.insurance_status, 'pending')) <> 'pending'
      OR EXISTS (SELECT 1 FROM bonzah_insurance_policies b WHERE b.rental_id = p_rental_id)
      OR EXISTS (SELECT 1 FROM insurance_verifications i WHERE i.rental_id = p_rental_id)
      OR EXISTS (SELECT 1 FROM rental_insurance_verifications ri WHERE ri.rental_id = p_rental_id)
      THEN 'Insurance has already been set up.'
    WHEN EXISTS (SELECT 1 FROM payments p WHERE p.rental_id = p_rental_id
                   AND COALESCE(p.status, '') NOT IN ('Reversed', 'Refunded'))
      OR EXISTS (SELECT 1 FROM installment_plans ip WHERE ip.rental_id = p_rental_id)
      OR EXISTS (SELECT 1 FROM rental_card_mandates m WHERE m.rental_id = p_rental_id)
      THEN 'Money has already been taken or arranged.'
    WHEN EXISTS (SELECT 1 FROM rental_key_handovers k WHERE k.rental_id = p_rental_id AND k.handed_at IS NOT NULL)
      THEN 'The car has already been handed over.'
    ELSE NULL
  END;
END $$;

REVOKE ALL ON FUNCTION public.rental_edit_blocker_v2(uuid) FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.update_rental_terms_v2(
  p_rental_id uuid,
  p_terms jsonb DEFAULT '{}'::jsonb,
  p_dry_run boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
END $$;

REVOKE ALL ON FUNCTION public.update_rental_terms_v2(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_rental_terms_v2(uuid, jsonb, boolean) TO authenticated;
