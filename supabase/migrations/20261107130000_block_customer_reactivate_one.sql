-- Blocking a customer failed with 409 (unique_violation) once their licence /
-- ID / document had been blocked and unblocked more than once: the reactivate
-- step switched EVERY old inactive entry back on, and idx_blocked_identities_unique
-- allows one active row per (identity_type, identity_number). It also clashed
-- when another tenant already had that identity active. Reactivate only the
-- newest old entry, and only when no active entry exists. Found by sheet C14.4.

CREATE OR REPLACE FUNCTION public.block_customer(p_customer_id uuid, p_reason text, p_blocked_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer RECORD;
  v_document_type text;
  v_actor_id uuid;
  v_rows_affected integer;
BEGIN
  -- Get actor_id from app_users (use p_blocked_by if provided, otherwise look up)
  IF p_blocked_by IS NOT NULL THEN
    v_actor_id := p_blocked_by;
  ELSE
    SELECT id INTO v_actor_id
    FROM app_users
    WHERE auth_user_id = auth.uid();
  END IF;

  -- Get customer details including their tenant_id
  SELECT c.id, c.name, c.email, c.license_number, c.id_number, c.tenant_id,
         iv.document_number, iv.document_type
  INTO v_customer
  FROM customers c
  LEFT JOIN identity_verifications iv ON iv.customer_id = c.id
  WHERE c.id = p_customer_id;

  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Customer not found');
  END IF;

  -- Block the customer
  UPDATE customers
  SET is_blocked = true,
      blocked_at = now(),
      blocked_reason = p_reason
  WHERE id = p_customer_id;

  -- Handle license number - try to reactivate existing record first, then insert if needed
  IF v_customer.license_number IS NOT NULL AND v_customer.license_number != '' THEN
    -- First try to reactivate an existing inactive record
    UPDATE blocked_identities
    SET is_active = true,
        reason = p_reason,
        blocked_by = p_blocked_by,
        notes = 'Blocked via customer: ' || v_customer.name,
        updated_at = now()
    WHERE id = (
        SELECT b.id FROM blocked_identities b
        WHERE b.identity_number = v_customer.license_number AND b.identity_type = 'license'
          AND b.tenant_id = v_customer.tenant_id AND b.is_active = false
        ORDER BY b.updated_at DESC NULLS LAST, b.created_at DESC
        LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM blocked_identities a
        WHERE a.identity_number = v_customer.license_number AND a.identity_type = 'license' AND a.is_active = true
      );

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    -- If no record was reactivated, insert a new one
    IF v_rows_affected = 0 THEN
      INSERT INTO blocked_identities (identity_type, identity_number, reason, blocked_by, notes, tenant_id, is_active)
      VALUES ('license', v_customer.license_number, p_reason, p_blocked_by, 'Blocked via customer: ' || v_customer.name, v_customer.tenant_id, true)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Handle ID number - try to reactivate existing record first, then insert if needed
  IF v_customer.id_number IS NOT NULL AND v_customer.id_number != '' THEN
    UPDATE blocked_identities
    SET is_active = true,
        reason = p_reason,
        blocked_by = p_blocked_by,
        notes = 'Blocked via customer: ' || v_customer.name,
        updated_at = now()
    WHERE id = (
        SELECT b.id FROM blocked_identities b
        WHERE b.identity_number = v_customer.id_number AND b.identity_type = 'id_card'
          AND b.tenant_id = v_customer.tenant_id AND b.is_active = false
        ORDER BY b.updated_at DESC NULLS LAST, b.created_at DESC
        LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM blocked_identities a
        WHERE a.identity_number = v_customer.id_number AND a.identity_type = 'id_card' AND a.is_active = true
      );

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected = 0 THEN
      INSERT INTO blocked_identities (identity_type, identity_number, reason, blocked_by, notes, tenant_id, is_active)
      VALUES ('id_card', v_customer.id_number, p_reason, p_blocked_by, 'Blocked via customer: ' || v_customer.name, v_customer.tenant_id, true)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Handle Veriff document number - try to reactivate existing record first, then insert if needed
  IF v_customer.document_number IS NOT NULL AND v_customer.document_number != '' THEN
    v_document_type := CASE
      WHEN lower(v_customer.document_type) LIKE '%passport%' THEN 'passport'
      WHEN lower(v_customer.document_type) LIKE '%license%' OR lower(v_customer.document_type) LIKE '%driving%' THEN 'license'
      ELSE 'id_card'
    END;

    UPDATE blocked_identities
    SET is_active = true,
        reason = p_reason,
        blocked_by = p_blocked_by,
        notes = 'Blocked via Veriff document: ' || v_customer.name,
        updated_at = now()
    WHERE id = (
        SELECT b.id FROM blocked_identities b
        WHERE b.identity_number = v_customer.document_number AND b.identity_type = v_document_type
          AND b.tenant_id = v_customer.tenant_id AND b.is_active = false
        ORDER BY b.updated_at DESC NULLS LAST, b.created_at DESC
        LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM blocked_identities a
        WHERE a.identity_number = v_customer.document_number AND a.identity_type = v_document_type AND a.is_active = true
      );

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected = 0 THEN
      INSERT INTO blocked_identities (identity_type, identity_number, reason, blocked_by, notes, tenant_id, is_active)
      VALUES (v_document_type, v_customer.document_number, p_reason, p_blocked_by, 'Blocked via Veriff document: ' || v_customer.name, v_customer.tenant_id, true)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Write to audit log
  INSERT INTO audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    details
  ) VALUES (
    v_customer.tenant_id,
    v_actor_id,
    'BLOCK_CUSTOMER',
    'customers',
    p_customer_id,
    jsonb_build_object(
      'previous_state', jsonb_build_object('is_blocked', false),
      'new_state', jsonb_build_object(
        'is_blocked', true,
        'blocked_reason', p_reason,
        'customer_name', v_customer.name,
        'customer_email', v_customer.email
      ),
      'blocked_identities', jsonb_build_array(
        v_customer.license_number,
        v_customer.id_number,
        v_customer.document_number
      )
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'blocked_identities', jsonb_build_array(
      v_customer.license_number,
      v_customer.id_number,
      v_customer.document_number
    )
  );
END;
$function$;
