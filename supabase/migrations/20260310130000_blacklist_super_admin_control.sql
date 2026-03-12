-- ============================================================================
-- Migration: Blacklist super admin control
-- Date: 2026-03-10
-- Description: Add whitelist columns to global_blacklist so super admins can
--              override automatic blacklisting. Blacklist entries are no longer
--              auto-removed when the tenant block count drops below 3.
-- ============================================================================

-- 1. Add whitelist columns to global_blacklist
ALTER TABLE global_blacklist ADD COLUMN IF NOT EXISTS is_whitelisted BOOLEAN DEFAULT false;
ALTER TABLE global_blacklist ADD COLUMN IF NOT EXISTS whitelisted_by UUID REFERENCES app_users(id);
ALTER TABLE global_blacklist ADD COLUMN IF NOT EXISTS whitelisted_at TIMESTAMPTZ;
ALTER TABLE global_blacklist ADD COLUMN IF NOT EXISTS whitelist_reason TEXT;

-- 2. Modify check_and_update_global_blacklist
--    - Still counts tenant blocks and updates blocked_tenant_count
--    - Still ADDS to blacklist when count >= 3
--    - NO LONGER REMOVES from blacklist when count drops below 3 (only updates count)
--    - If entry exists and is_whitelisted = true, don't re-blacklist even if count >= 3
CREATE OR REPLACE FUNCTION check_and_update_global_blacklist(p_email TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_tenant_count INTEGER;
  v_first_blocked TIMESTAMPTZ;
  v_last_blocked TIMESTAMPTZ;
  v_existing RECORD;
BEGIN
  -- Count distinct tenants that have blocked this email
  SELECT
    COUNT(DISTINCT tenant_id),
    MIN(created_at),
    MAX(created_at)
  INTO v_tenant_count, v_first_blocked, v_last_blocked
  FROM blocked_identities
  WHERE identity_number = p_email
    AND identity_type = 'email'
    AND is_active = true;

  -- Check if entry already exists
  SELECT id, is_whitelisted
  INTO v_existing
  FROM global_blacklist
  WHERE email = p_email;

  IF v_existing.id IS NOT NULL THEN
    -- Entry exists: always update the count, but respect whitelist status
    UPDATE global_blacklist
    SET blocked_tenant_count = v_tenant_count,
        last_blocked_at = v_last_blocked,
        updated_at = NOW()
    WHERE email = p_email;

    -- Return true (blacklisted) only if not whitelisted and count >= 3
    RETURN (v_tenant_count >= 3 AND NOT v_existing.is_whitelisted);
  ELSE
    -- No existing entry: only create one if count >= 3
    IF v_tenant_count >= 3 THEN
      INSERT INTO global_blacklist (email, blocked_tenant_count, first_blocked_at, last_blocked_at, updated_at)
      VALUES (p_email, v_tenant_count, v_first_blocked, v_last_blocked, NOW());
      RETURN TRUE;
    END IF;

    RETURN FALSE;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update is_globally_blacklisted to respect whitelist
--    Returns true only if entry exists AND is_whitelisted = false
CREATE OR REPLACE FUNCTION is_globally_blacklisted(p_email TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM global_blacklist
    WHERE email = p_email
      AND is_whitelisted = false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Modify unblock_customer to update global blacklist count
--    Keeps all existing logic, adds global blacklist count update after identity deactivation
CREATE OR REPLACE FUNCTION public.unblock_customer(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer RECORD;
  v_caller_tenant_id uuid;
  v_caller_app_user_id uuid;
  v_unblocked_count integer := 0;
  v_rows_affected integer;
BEGIN
  -- Get the caller's app_user id and tenant_id
  SELECT id, tenant_id INTO v_caller_app_user_id, v_caller_tenant_id
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

  -- Update global blacklist count (entry stays, only count is refreshed)
  IF v_customer.email IS NOT NULL AND v_customer.email != '' THEN
    PERFORM check_and_update_global_blacklist(v_customer.email);
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
    v_caller_app_user_id,
    'UNBLOCK_CUSTOMER',
    'customers',
    p_customer_id,
    jsonb_build_object(
      'customer_name', v_customer.name,
      'customer_email', v_customer.email,
      'previous_reason', v_customer.blocked_reason,
      'unblocked_identities_count', v_unblocked_count
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

-- Ensure proper grants
GRANT EXECUTE ON FUNCTION public.unblock_customer(uuid) TO authenticated;

-- 5. Add RLS policy for super admin management of global_blacklist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Super admins can manage global blacklist' AND tablename = 'global_blacklist'
  ) THEN
    CREATE POLICY "Super admins can manage global blacklist"
      ON global_blacklist FOR ALL
      USING (is_super_admin())
      WITH CHECK (is_super_admin());
  END IF;
END $$;

-- 6. Update the v_global_blacklist_details view to include whitelist columns
-- Must DROP first because adding new columns in the middle changes column positions
DROP VIEW IF EXISTS v_global_blacklist_details;
CREATE VIEW v_global_blacklist_details AS
SELECT
  gb.id,
  gb.email,
  gb.blocked_tenant_count,
  gb.is_whitelisted,
  gb.whitelisted_by,
  gb.whitelisted_at,
  gb.whitelist_reason,
  gb.first_blocked_at,
  gb.last_blocked_at,
  gb.created_at,
  COALESCE(
    json_agg(
      json_build_object(
        'tenant_id', bi.tenant_id,
        'tenant_name', t.company_name,
        'reason', bi.reason,
        'blocked_at', bi.created_at
      )
    ) FILTER (WHERE bi.id IS NOT NULL),
    '[]'::json
  ) as blocking_tenants
FROM global_blacklist gb
LEFT JOIN blocked_identities bi ON bi.identity_number = gb.email
  AND bi.identity_type = 'email'
  AND bi.is_active = true
LEFT JOIN tenants t ON t.id = bi.tenant_id
GROUP BY gb.id, gb.email, gb.blocked_tenant_count, gb.is_whitelisted,
         gb.whitelisted_by, gb.whitelisted_at, gb.whitelist_reason,
         gb.first_blocked_at, gb.last_blocked_at, gb.created_at;
