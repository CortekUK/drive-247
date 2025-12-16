-- Migration: Remove email from blocking - only block by license/ID
-- Blocking should only be based on license_number, not email

-- Update the block_customer function to NOT block by email
CREATE OR REPLACE FUNCTION block_customer(
  p_customer_id UUID,
  p_reason TEXT,
  p_blocked_by UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_customer RECORD;
  v_result JSONB;
BEGIN
  -- Get customer details
  SELECT c.*, iv.document_number, iv.document_type
  INTO v_customer
  FROM customers c
  LEFT JOIN identity_verifications iv ON iv.customer_id = c.id
  WHERE c.id = p_customer_id
  ORDER BY iv.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Customer not found');
  END IF;

  -- Check if customer has a license number (required for blocking)
  IF (v_customer.license_number IS NULL OR v_customer.license_number = '')
     AND (v_customer.document_number IS NULL OR v_customer.document_number = '') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot block customer without a license number');
  END IF;

  -- Update customer as blocked
  UPDATE customers
  SET is_blocked = true,
      blocked_at = now(),
      blocked_reason = p_reason
  WHERE id = p_customer_id;

  -- Add license number to blocked list if available
  IF v_customer.license_number IS NOT NULL AND v_customer.license_number != '' THEN
    INSERT INTO blocked_identities (identity_type, identity_number, reason, blocked_by, notes)
    VALUES ('license', v_customer.license_number, p_reason, p_blocked_by, 'Blocked via customer: ' || v_customer.name)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Add ID number to blocked list if available
  IF v_customer.id_number IS NOT NULL AND v_customer.id_number != '' THEN
    INSERT INTO blocked_identities (identity_type, identity_number, reason, blocked_by, notes)
    VALUES ('id_card', v_customer.id_number, p_reason, p_blocked_by, 'Blocked via customer: ' || v_customer.name)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Add document number from Veriff verification if available
  IF v_customer.document_number IS NOT NULL AND v_customer.document_number != '' THEN
    INSERT INTO blocked_identities (
      identity_type,
      identity_number,
      reason,
      blocked_by,
      notes
    )
    VALUES (
      CASE
        WHEN LOWER(v_customer.document_type) = 'drivers_license' THEN 'license'
        WHEN LOWER(v_customer.document_type) = 'id_card' THEN 'id_card'
        WHEN LOWER(v_customer.document_type) = 'passport' THEN 'passport'
        ELSE 'license'
      END,
      v_customer.document_number,
      p_reason,
      p_blocked_by,
      'Blocked via customer: ' || v_customer.name || ' (from Veriff)'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  -- NOTE: We intentionally do NOT block by email anymore

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'blocked_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update unblock_customer to NOT unblock email entries
CREATE OR REPLACE FUNCTION unblock_customer(
  p_customer_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_customer RECORD;
BEGIN
  -- Get customer details
  SELECT * INTO v_customer
  FROM customers
  WHERE id = p_customer_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Customer not found');
  END IF;

  -- Update customer as unblocked
  UPDATE customers
  SET is_blocked = false,
      blocked_at = NULL,
      blocked_reason = NULL
  WHERE id = p_customer_id;

  -- Deactivate blocked identity entries for this customer's identifiers (only license/ID, not email)
  UPDATE blocked_identities
  SET is_active = false, updated_at = now()
  WHERE identity_number IN (v_customer.license_number, v_customer.id_number)
    AND identity_type IN ('license', 'id_card', 'passport');

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'unblocked_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Deactivate any existing email-based blocked identities (cleanup)
UPDATE blocked_identities
SET is_active = false, updated_at = now(), notes = COALESCE(notes, '') || ' [Deactivated: email blocking removed]'
WHERE identity_type = 'email' AND is_active = true;
