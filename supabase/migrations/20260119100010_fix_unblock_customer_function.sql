-- ============================================================================
-- Migration: Fix unblock_customer function
-- Date: 2026-01-19
-- Description: Fix bug where unblocking a customer doesn't properly deactivate
--              blocked identities due to NULL handling issues and missing
--              Veriff document_number in the unblock logic.
-- ============================================================================

-- Drop and recreate the function with proper NULL handling
CREATE OR REPLACE FUNCTION public.unblock_customer(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer RECORD;
  v_caller_tenant_id uuid;
  v_unblocked_count integer := 0;
  v_rows_affected integer;
BEGIN
  -- Get the caller's tenant_id from app_users
  SELECT tenant_id INTO v_caller_tenant_id
  FROM app_users
  WHERE auth_user_id = auth.uid();

  -- Get customer details INCLUDING Veriff document info (same as block_customer)
  SELECT c.id, c.name, c.email, c.license_number, c.id_number, c.tenant_id, c.blocked_reason,
         iv.document_number
  INTO v_customer
  FROM customers c
  LEFT JOIN identity_verifications iv ON iv.customer_id = c.id
  WHERE c.id = p_customer_id;

  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Customer not found');
  END IF;

  -- Validate caller has access to this customer's tenant
  IF v_caller_tenant_id IS NOT NULL AND v_customer.tenant_id != v_caller_tenant_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied: Customer belongs to different tenant');
  END IF;

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
  -- This was MISSING in the original function!
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

-- Ensure proper grants
GRANT EXECUTE ON FUNCTION public.unblock_customer(uuid) TO authenticated;
