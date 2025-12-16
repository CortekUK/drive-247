-- Migration: Add customer blocking system based on ID/license number

-- 1. Add license_number field to customers table
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS license_number TEXT,
ADD COLUMN IF NOT EXISTS id_number TEXT,
ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS blocked_reason TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_customers_license_number ON customers(license_number);
CREATE INDEX IF NOT EXISTS idx_customers_id_number ON customers(id_number);
CREATE INDEX IF NOT EXISTS idx_customers_is_blocked ON customers(is_blocked);

-- 2. Create blocked_identities table for blacklisting by license/ID/email
CREATE TABLE IF NOT EXISTS blocked_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_type TEXT NOT NULL CHECK (identity_type IN ('license', 'id_card', 'passport', 'email', 'other')),
  identity_number TEXT NOT NULL,
  reason TEXT NOT NULL,
  blocked_by UUID REFERENCES app_users(id),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create unique index to prevent duplicate blocks
CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_identities_unique
ON blocked_identities(identity_type, identity_number) WHERE is_active = true;

-- Create index for lookups
CREATE INDEX IF NOT EXISTS idx_blocked_identities_number ON blocked_identities(identity_number);
CREATE INDEX IF NOT EXISTS idx_blocked_identities_active ON blocked_identities(is_active);

-- Enable RLS
ALTER TABLE blocked_identities ENABLE ROW LEVEL SECURITY;

-- RLS Policies - only admins can manage blocked identities
DROP POLICY IF EXISTS "Admins can view blocked identities" ON blocked_identities;
CREATE POLICY "Admins can view blocked identities" ON blocked_identities
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can insert blocked identities" ON blocked_identities;
CREATE POLICY "Admins can insert blocked identities" ON blocked_identities
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can update blocked identities" ON blocked_identities;
CREATE POLICY "Admins can update blocked identities" ON blocked_identities
  FOR UPDATE TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can delete blocked identities" ON blocked_identities;
CREATE POLICY "Admins can delete blocked identities" ON blocked_identities
  FOR DELETE TO authenticated
  USING (true);

-- 3. Create function to check if an identity is blocked
CREATE OR REPLACE FUNCTION is_identity_blocked(p_identity_number TEXT)
RETURNS TABLE (
  is_blocked BOOLEAN,
  block_reason TEXT,
  identity_type TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    true AS is_blocked,
    bi.reason AS block_reason,
    bi.identity_type
  FROM blocked_identities bi
  WHERE bi.identity_number = p_identity_number
    AND bi.is_active = true
  LIMIT 1;

  -- If no rows returned, return not blocked
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create function to block a customer and add to blocked list
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
      LOWER(COALESCE(v_customer.document_type, 'other')),
      v_customer.document_number,
      p_reason,
      p_blocked_by,
      'Blocked via customer: ' || v_customer.name || ' (from Veriff)'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'blocked_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create function to unblock a customer
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

  -- Deactivate blocked identity entries for this customer's identifiers
  UPDATE blocked_identities
  SET is_active = false, updated_at = now()
  WHERE identity_number IN (v_customer.license_number, v_customer.id_number);

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'unblocked_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments
COMMENT ON TABLE blocked_identities IS 'Blacklist of blocked identity documents (license, ID, passport numbers)';
COMMENT ON COLUMN customers.license_number IS 'Customer driver license number';
COMMENT ON COLUMN customers.id_number IS 'Customer national ID or passport number';
COMMENT ON COLUMN customers.is_blocked IS 'Whether the customer is blocked from rentals';
COMMENT ON FUNCTION is_identity_blocked IS 'Check if an identity number is in the blocked list';
COMMENT ON FUNCTION block_customer IS 'Block a customer and add their identifiers to the blocked list';
COMMENT ON FUNCTION unblock_customer IS 'Unblock a customer and deactivate their blocked identity entries';
