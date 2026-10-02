-- change_rental_customer_v2 — give a rental a different customer, while it is
-- still early enough for that to be honest.
--
-- v2 (northwind) only: nothing in v1 calls it. Additive — a new function, no
-- schema change (V2_PLAN §4).
--
-- WHEN IT IS ALLOWED (Ghulam, 2026-10-02): only while the rental has not moved
-- past its first four stages — Customer, Vehicle, When & where, Extras. The
-- moment anything has happened in Agreement, Insurance, Payments or Handover,
-- the customer is part of a record (a signed document, a policy, money taken, a
-- car handed over) and changing it would make that record lie. Cancel and
-- rebook is the route then.
--
-- WHAT MOVES: the rental, and the rows that carry its customer and can exist
-- before money does — ledger charges, invoices, P&L and financial events. All
-- in this one transaction, so nothing is left half on the old customer.
--
-- p_dry_run = true answers "may I?" without writing: the UI uses it to disable
-- the action and say WHY, from the same rules that guard the write.
--
-- Tenant isolation (RLS is off on these tables, V2_PLAN §5): the caller must be
-- an active, non-viewer app user of the rental's tenant, or a super admin; the
-- new customer must belong to the rental's tenant.

CREATE OR REPLACE FUNCTION public.change_rental_customer_v2(
  p_rental_id uuid,
  p_new_customer_id uuid DEFAULT NULL,
  p_dry_run boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rental   record;
  v_customer record;
  v_blocker  text;
BEGIN
  SELECT id, tenant_id, customer_id, status, insurance_status,
         docusign_envelope_id, signed_document_id
    INTO v_rental
    FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'This rental does not exist.');
  END IF;

  -- Who is asking. Same "not found" answer for another tenant's rental: do not
  -- confirm it exists.
  IF NOT EXISTS (
    SELECT 1 FROM app_users u
     WHERE u.auth_user_id = auth.uid()
       AND COALESCE(u.is_active, true)
       AND (u.is_super_admin IS TRUE
            OR (u.tenant_id = v_rental.tenant_id AND COALESCE(u.role, '') <> 'viewer'))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'This rental does not exist.');
  END IF;

  -- ── the guards, in stage order ──────────────────────────────────────────
  v_blocker := CASE
    WHEN lower(COALESCE(v_rental.status, '')) <> 'pending'
      THEN 'Only a pending rental can change customer. This one is ' || COALESCE(v_rental.status, 'without a status') || '.'
    WHEN v_rental.docusign_envelope_id IS NOT NULL OR v_rental.signed_document_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM rental_agreements a WHERE a.rental_id = p_rental_id
                   AND (a.envelope_sent_at IS NOT NULL OR a.signed_document_id IS NOT NULL))
      THEN 'The agreement has already gone out to this customer.'
    WHEN lower(COALESCE(v_rental.insurance_status, 'pending')) <> 'pending'
      OR EXISTS (SELECT 1 FROM bonzah_insurance_policies b WHERE b.rental_id = p_rental_id)
      OR EXISTS (SELECT 1 FROM insurance_verifications i WHERE i.rental_id = p_rental_id)
      OR EXISTS (SELECT 1 FROM rental_insurance_verifications ri WHERE ri.rental_id = p_rental_id)
      THEN 'Insurance has already been set up for this customer.'
    WHEN EXISTS (SELECT 1 FROM payments p WHERE p.rental_id = p_rental_id
                   AND COALESCE(p.status, '') NOT IN ('Reversed', 'Refunded'))
      OR EXISTS (SELECT 1 FROM installment_plans ip WHERE ip.rental_id = p_rental_id)
      OR EXISTS (SELECT 1 FROM rental_card_mandates m WHERE m.rental_id = p_rental_id)
      THEN 'Money has already been taken or arranged against this customer.'
    WHEN EXISTS (SELECT 1 FROM rental_key_handovers k WHERE k.rental_id = p_rental_id AND k.handed_at IS NOT NULL)
      THEN 'The car has already been handed over.'
    ELSE NULL
  END;

  IF v_blocker IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_blocker || ' Cancel and rebook to change who is renting.');
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- ── the new customer ────────────────────────────────────────────────────
  IF p_new_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Pick the customer to move this rental to.');
  END IF;
  SELECT id, tenant_id, name, is_blocked INTO v_customer
    FROM customers WHERE id = p_new_customer_id AND tenant_id = v_rental.tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'That customer was not found.');
  END IF;
  IF v_customer.is_blocked IS TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_customer.name || ' is blocked and cannot rent.');
  END IF;
  IF v_customer.id = v_rental.customer_id THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true);
  END IF;

  -- ── the move — one transaction, every row scoped by rental AND tenant ──
  UPDATE rentals          SET customer_id = p_new_customer_id WHERE id = p_rental_id AND tenant_id = v_rental.tenant_id;
  UPDATE ledger_entries   SET customer_id = p_new_customer_id WHERE rental_id = p_rental_id AND tenant_id = v_rental.tenant_id;
  UPDATE invoices         SET customer_id = p_new_customer_id WHERE rental_id = p_rental_id AND tenant_id = v_rental.tenant_id;
  UPDATE pnl_entries      SET customer_id = p_new_customer_id WHERE rental_id = p_rental_id AND tenant_id = v_rental.tenant_id;
  UPDATE financial_events SET customer_id = p_new_customer_id WHERE rental_id = p_rental_id AND tenant_id = v_rental.tenant_id;

  RETURN jsonb_build_object('ok', true, 'customer_name', v_customer.name);
END $$;

REVOKE ALL ON FUNCTION public.change_rental_customer_v2(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_rental_customer_v2(uuid, uuid, boolean) TO authenticated;
