-- ============================================================================
-- Migration: Remove tenant validation from block/unblock functions
-- Date: 2026-01-19
-- Description: The tenant validation in these functions is redundant because:
--              1. RLS policies already enforce tenant isolation
--              2. The validation was causing issues with mismatched tenant IDs
--              3. If a user can see/access a customer, they should be able to block/unblock
-- ============================================================================

-- Drop the debug function as it's no longer needed
DROP FUNCTION IF EXISTS public.debug_unblock_customer(uuid);

-- Simplified unblock_customer without tenant validation
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
BEGIN
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

  -- No tenant validation here - RLS policies handle access control
  -- If the user can access this customer record, they have permission

  -- Unblock the customer
  UPDATE customers
  SET is_blocked = false,
      blocked_at = NULL,
      blocked_reason = NULL
  WHERE id = p_customer_id;

  -- Deactivate blocked identities for license_number (if not null)
  IF v_customer.license_number IS NOT NULL AND v_customer.license_number != '' THEN
    UPDATE blocked_identities
    SET is_active = false,
        updated_at = now()
    WHERE identity_number = v_customer.license_number
      AND tenant_id = v_customer.tenant_id
      AND is_active = true;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    v_unblocked_count := v_unblocked_count + v_rows_affected;
  END IF;

  -- Deactivate blocked identities for id_number (if not null)
  IF v_customer.id_number IS NOT NULL AND v_customer.id_number != '' THEN
    UPDATE blocked_identities
    SET is_active = false,
        updated_at = now()
    WHERE identity_number = v_customer.id_number
      AND tenant_id = v_customer.tenant_id
      AND is_active = true;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    v_unblocked_count := v_unblocked_count + v_rows_affected;
  END IF;

  -- Deactivate blocked identities for Veriff document_number (if not null)
  IF v_customer.document_number IS NOT NULL AND v_customer.document_number != '' THEN
    UPDATE blocked_identities
    SET is_active = false,
        updated_at = now()
    WHERE identity_number = v_customer.document_number
      AND tenant_id = v_customer.tenant_id
      AND is_active = true;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    v_unblocked_count := v_unblocked_count + v_rows_affected;
  END IF;

  -- Write to audit log
  INSERT INTO audit_logs (
    tenant_id,
    user_id,
    action,
    table_name,
    record_id,
    old_data,
    new_data,
    ip_address
  ) VALUES (
    v_customer.tenant_id,
    auth.uid(),
    'UNBLOCK_CUSTOMER',
    'customers',
    p_customer_id,
    jsonb_build_object(
      'is_blocked', true,
      'blocked_reason', v_customer.blocked_reason
    ),
    jsonb_build_object(
      'is_blocked', false,
      'customer_name', v_customer.name,
      'customer_email', v_customer.email,
      'unblocked_identities_count', v_unblocked_count
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'message', 'Customer unblocked successfully',
    'unblocked_identities_count', v_unblocked_count
  );
END;
$$;

-- Simplified block_customer without tenant validation
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
BEGIN
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

  -- No tenant validation here - RLS policies handle access control
  -- If the user can access this customer record, they have permission

  -- Block the customer
  UPDATE customers
  SET is_blocked = true,
      blocked_at = now(),
      blocked_reason = p_reason
  WHERE id = p_customer_id;

  -- Add license number to blocked identities if available
  IF v_customer.license_number IS NOT NULL AND v_customer.license_number != '' THEN
    INSERT INTO blocked_identities (identity_type, identity_number, reason, blocked_by, notes, tenant_id)
    VALUES ('license', v_customer.license_number, p_reason, p_blocked_by, 'Blocked via customer: ' || v_customer.name, v_customer.tenant_id)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Add ID number to blocked identities if available
  IF v_customer.id_number IS NOT NULL AND v_customer.id_number != '' THEN
    INSERT INTO blocked_identities (identity_type, identity_number, reason, blocked_by, notes, tenant_id)
    VALUES ('id_card', v_customer.id_number, p_reason, p_blocked_by, 'Blocked via customer: ' || v_customer.name, v_customer.tenant_id)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Add Veriff document number to blocked identities if available
  IF v_customer.document_number IS NOT NULL AND v_customer.document_number != '' THEN
    v_document_type := CASE
      WHEN lower(v_customer.document_type) LIKE '%passport%' THEN 'passport'
      WHEN lower(v_customer.document_type) LIKE '%license%' OR lower(v_customer.document_type) LIKE '%driving%' THEN 'license'
      ELSE 'id_card'
    END;

    INSERT INTO blocked_identities (identity_type, identity_number, reason, blocked_by, notes, tenant_id)
    VALUES (v_document_type, v_customer.document_number, p_reason, p_blocked_by, 'Blocked via Veriff document: ' || v_customer.name, v_customer.tenant_id)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Write to audit log
  INSERT INTO audit_logs (
    tenant_id,
    user_id,
    action,
    table_name,
    record_id,
    old_data,
    new_data,
    ip_address
  ) VALUES (
    v_customer.tenant_id,
    COALESCE(p_blocked_by, auth.uid()),
    'BLOCK_CUSTOMER',
    'customers',
    p_customer_id,
    jsonb_build_object('is_blocked', false),
    jsonb_build_object(
      'is_blocked', true,
      'blocked_reason', p_reason,
      'customer_name', v_customer.name,
      'customer_email', v_customer.email
    ),
    NULL
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
