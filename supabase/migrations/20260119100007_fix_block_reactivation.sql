-- ============================================================================
-- Migration: Fix block/unblock to properly handle reactivation
-- Date: 2026-01-19
-- Description: When blocking a customer who was previously unblocked, we need
--              to reactivate the existing blocked_identities records instead
--              of trying to insert new ones (which fails due to ON CONFLICT DO NOTHING)
-- ============================================================================

-- Fix unblock_customer - ensure we're deactivating correctly
CREATE OR REPLACE FUNCTION public.unblock_customer(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer RECORD;
  v_unblocked_count integer := 0;
  v_rows_affected integer;
  v_actor_id uuid;
BEGIN
  -- Get actor_id from app_users
  SELECT id INTO v_actor_id
  FROM app_users
  WHERE auth_user_id = auth.uid();

  -- Get customer details INCLUDING Veriff document info
  SELECT c.id, c.name, c.email, c.license_number, c.id_number, c.tenant_id, c.blocked_reason,
         iv.document_number
  INTO v_customer
  FROM customers c
  LEFT JOIN identity_verifications iv ON iv.customer_id = c.id
  WHERE c.id = p_customer_id;

  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Customer not found');
  END IF;

  -- Unblock the customer
  UPDATE customers
  SET is_blocked = false,
      blocked_at = NULL,
      blocked_reason = NULL
  WHERE id = p_customer_id;

  -- Deactivate ALL blocked identities matching any of this customer's identifiers
  -- Don't filter by tenant_id in case records were created differently
  IF v_customer.license_number IS NOT NULL AND v_customer.license_number != '' THEN
    UPDATE blocked_identities
    SET is_active = false,
        updated_at = now()
    WHERE identity_number = v_customer.license_number
      AND is_active = true;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    v_unblocked_count := v_unblocked_count + v_rows_affected;
  END IF;

  IF v_customer.id_number IS NOT NULL AND v_customer.id_number != '' THEN
    UPDATE blocked_identities
    SET is_active = false,
        updated_at = now()
    WHERE identity_number = v_customer.id_number
      AND is_active = true;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    v_unblocked_count := v_unblocked_count + v_rows_affected;
  END IF;

  IF v_customer.document_number IS NOT NULL AND v_customer.document_number != '' THEN
    UPDATE blocked_identities
    SET is_active = false,
        updated_at = now()
    WHERE identity_number = v_customer.document_number
      AND is_active = true;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    v_unblocked_count := v_unblocked_count + v_rows_affected;
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
    'UNBLOCK_CUSTOMER',
    'customers',
    p_customer_id,
    jsonb_build_object(
      'previous_state', jsonb_build_object(
        'is_blocked', true,
        'blocked_reason', v_customer.blocked_reason
      ),
      'new_state', jsonb_build_object(
        'is_blocked', false,
        'customer_name', v_customer.name,
        'customer_email', v_customer.email,
        'unblocked_identities_count', v_unblocked_count
      )
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'message', 'Customer unblocked successfully',
    'unblocked_identities_count', v_unblocked_count
  );
END;
$$;

-- Fix block_customer - reactivate existing records or insert new ones
CREATE OR REPLACE FUNCTION public.block_customer(
  p_customer_id uuid,
  p_reason text,
  p_blocked_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    WHERE identity_number = v_customer.license_number
      AND identity_type = 'license'
      AND tenant_id = v_customer.tenant_id
      AND is_active = false;

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
    WHERE identity_number = v_customer.id_number
      AND identity_type = 'id_card'
      AND tenant_id = v_customer.tenant_id
      AND is_active = false;

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
    WHERE identity_number = v_customer.document_number
      AND identity_type = v_document_type
      AND tenant_id = v_customer.tenant_id
      AND is_active = false;

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
$$;

-- Ensure proper grants
GRANT EXECUTE ON FUNCTION public.block_customer(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_customer(uuid) TO authenticated;
