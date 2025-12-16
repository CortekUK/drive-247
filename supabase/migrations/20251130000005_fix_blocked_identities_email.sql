-- Migration: Fix blocked_identities to support email identity type

-- Drop the old constraint and add a new one that includes email
ALTER TABLE blocked_identities
DROP CONSTRAINT IF EXISTS blocked_identities_identity_type_check;

ALTER TABLE blocked_identities
ADD CONSTRAINT blocked_identities_identity_type_check
CHECK (identity_type IN ('license', 'id_card', 'passport', 'email', 'other'));

-- Update the block_customer function to also block by email when no license/id available
CREATE OR REPLACE FUNCTION block_customer(
  p_customer_id UUID,
  p_reason TEXT,
  p_blocked_by UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_customer RECORD;
  v_result JSONB;
  v_has_identity BOOLEAN := false;
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
    v_has_identity := true;
  END IF;

  -- Add ID number to blocked list if available
  IF v_customer.id_number IS NOT NULL AND v_customer.id_number != '' THEN
    INSERT INTO blocked_identities (identity_type, identity_number, reason, blocked_by, notes)
    VALUES ('id_card', v_customer.id_number, p_reason, p_blocked_by, 'Blocked via customer: ' || v_customer.name)
    ON CONFLICT DO NOTHING;
    v_has_identity := true;
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
      LOWER(COALESCE(v_customer.document_type, 'other')),
      v_customer.document_number,
      p_reason,
      p_blocked_by,
      'Blocked via customer: ' || v_customer.name || ' (from Veriff)'
    )
    ON CONFLICT DO NOTHING;
    v_has_identity := true;
  END IF;

  -- If no license/ID/document available, block by email as fallback
  IF NOT v_has_identity AND v_customer.email IS NOT NULL AND v_customer.email != '' THEN
    INSERT INTO blocked_identities (identity_type, identity_number, reason, blocked_by, notes)
    VALUES ('email', v_customer.email, p_reason, p_blocked_by, 'Blocked via customer: ' || v_customer.name || ' (email fallback)')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'blocked_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update unblock_customer to also handle email unblocking
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

  -- Deactivate blocked identity entries for this customer's identifiers (including email)
  UPDATE blocked_identities
  SET is_active = false, updated_at = now()
  WHERE identity_number IN (v_customer.license_number, v_customer.id_number, v_customer.email);

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'unblocked_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
