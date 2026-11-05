-- Deleting a rental must not silently lose its Bonzah policy.
--
-- Moore Luxe (2026-10-29): Bonzah issued a policy for a customer that Drive247
-- had no record of. delete_rental_cascade removes the rental, and the policy
-- row went with it through ON DELETE CASCADE, with no audit entry.
--
-- 1. delete_rental_cascade refuses rentals that have a Bonzah policy row.
-- 2. delete_rental_cascade writes a 'rental_deleted' audit entry with a
--    snapshot of the rental and its payments before deleting.
-- 3. The policy -> rental FK becomes ON DELETE SET NULL, so any other delete
--    path (Turo import, direct SQL) keeps the policy record instead of erasing it.

CREATE OR REPLACE FUNCTION public.delete_rental_cascade(rental_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle_id UUID;
  v_status TEXT;
  v_tenant_id UUID;
  v_caller_tenant UUID;
  v_is_super BOOLEAN;
  v_unrefunded NUMERIC;
  v_count INT;
  v_actor UUID;
  v_policy_count INT;
  v_policy_ref TEXT;
  v_snapshot JSONB;
BEGIN
  SELECT vehicle_id, status, tenant_id
    INTO v_vehicle_id, v_status, v_tenant_id
  FROM rentals
  WHERE id = rental_uuid;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Authorization: service_role bypasses (no auth.uid(), already trusted).
  -- Everyone else must be an active portal user of the owning tenant.
  IF auth.uid() IS NOT NULL THEN
    SELECT is_super_admin() INTO v_is_super;

    SELECT tenant_id, id INTO v_caller_tenant, v_actor
    FROM app_users
    WHERE auth_user_id = auth.uid()
      AND COALESCE(is_active, true) = true
    LIMIT 1;

    IF NOT COALESCE(v_is_super, false) THEN
      IF v_caller_tenant IS NULL THEN
        RAISE EXCEPTION 'Not permitted: no active portal profile for this account'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF v_tenant_id IS NULL OR v_caller_tenant <> v_tenant_id THEN
        RAISE EXCEPTION 'Not permitted: this rental belongs to another tenant'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  -- Money guard. Deleting the record does not return the money.
  SELECT COALESCE(SUM(amount - COALESCE(refund_amount, 0)), 0), COUNT(*)
    INTO v_unrefunded, v_count
  FROM payments
  WHERE rental_id = rental_uuid
    AND stripe_payment_intent_id IS NOT NULL
    AND COALESCE(capture_status, 'captured') = 'captured'
    AND (amount - COALESCE(refund_amount, 0)) > 0.005;

  IF v_unrefunded > 0.005 THEN
    RAISE EXCEPTION
      'Cannot delete this rental: % captured payment(s) still hold % that has not been refunded. Refund or reconcile them first — deleting the rental removes the payment records but does not return the money.',
      v_count, to_char(v_unrefunded, 'FM999999990.00')
      USING ERRCODE = 'check_violation';
  END IF;

  -- Bonzah guard. A Bonzah policy lives on at Bonzah whatever we do here, so
  -- deleting the rental only loses our record of it: Moore Luxe 2026-10-29,
  -- where a policy Bonzah had issued could not be found in Drive247. Quoted and
  -- insufficient_balance rows count too: either can still become a live policy.
  SELECT COUNT(*), string_agg(COALESCE(policy_no, quote_id, status), ', ')
    INTO v_policy_count, v_policy_ref
  FROM bonzah_insurance_policies
  WHERE rental_id = rental_uuid;

  IF v_policy_count > 0 THEN
    RAISE EXCEPTION
      'Cannot delete this rental: it has a Bonzah insurance policy (%). Cancel or close the rental instead, so the policy stays on record.',
      v_policy_ref
      USING ERRCODE = 'check_violation';
  END IF;

  -- Audit before deleting: once the rows are gone there is nothing left to say
  -- what this rental was or what was recorded against it.
  SELECT jsonb_build_object(
           'rental_number', r.rental_number,
           'status', r.status,
           'customer_id', r.customer_id,
           'vehicle_id', r.vehicle_id,
           'start_date', r.start_date,
           'end_date', r.end_date,
           'pickup_time', r.pickup_time,
           'return_time', r.return_time,
           'monthly_amount', r.monthly_amount,
           'insurance_status', r.insurance_status,
           'insurance_premium', r.insurance_premium,
           'payments', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'id', p.id, 'amount', p.amount, 'method', p.method,
                      'status', p.status, 'payment_date', p.payment_date,
                      'stripe_payment_intent_id', p.stripe_payment_intent_id))
             FROM payments p WHERE p.rental_id = rental_uuid), '[]'::jsonb)
         )
    INTO v_snapshot
  FROM rentals r
  WHERE r.id = rental_uuid;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, tenant_id, details, is_super_admin_action, activity_source)
  VALUES (v_actor, 'rental_deleted', 'rental', rental_uuid, v_tenant_id, v_snapshot,
          COALESCE(v_is_super, false),
          CASE WHEN auth.uid() IS NULL THEN 'system'
               WHEN COALESCE(v_is_super, false) THEN 'super_admin'
               ELSE 'tenant_user' END);

  -- Delete in correct dependency order to avoid FK violations
  DELETE FROM payment_applications
  WHERE payment_id IN (SELECT id FROM payments WHERE rental_id = rental_uuid);

  DELETE FROM ledger_entries WHERE rental_id = rental_uuid;
  DELETE FROM payments WHERE rental_id = rental_uuid;
  DELETE FROM invoices WHERE rental_id = rental_uuid;
  DELETE FROM reminder_events WHERE rental_id = rental_uuid;

  DELETE FROM rental_handover_photos
  WHERE handover_id IN (SELECT id FROM rental_key_handovers WHERE rental_id = rental_uuid);

  DELETE FROM rental_key_handovers WHERE rental_id = rental_uuid;
  DELETE FROM rental_insurance_verifications WHERE rental_id = rental_uuid;
  DELETE FROM customer_documents WHERE rental_id = rental_uuid;

  DELETE FROM rentals WHERE id = rental_uuid;

  IF v_vehicle_id IS NOT NULL THEN
    UPDATE vehicles
    SET status = 'Available'
    WHERE id = v_vehicle_id
      AND status = 'Rented'
      AND NOT EXISTS (
        SELECT 1 FROM rentals
        WHERE vehicle_id = v_vehicle_id
          AND status = 'Active'
      );
  END IF;
END;
$function$;

ALTER TABLE public.bonzah_insurance_policies
  DROP CONSTRAINT bonzah_insurance_policies_rental_id_fkey,
  ADD CONSTRAINT bonzah_insurance_policies_rental_id_fkey
    FOREIGN KEY (rental_id) REFERENCES public.rentals(id) ON DELETE SET NULL;
