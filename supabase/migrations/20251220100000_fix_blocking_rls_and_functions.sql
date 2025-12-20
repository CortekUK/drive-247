-- Migration: Fix blocking feature RLS policies and functions for proper multi-tenant isolation
-- This migration:
-- 1. Drops overly permissive RLS policies on blocked_identities
-- 2. Creates tenant-scoped RLS policies
-- 3. Updates block_customer() function with tenant validation and audit logging
-- 4. Updates unblock_customer() function with tenant validation and audit logging
-- 5. Creates new tenant-aware is_identity_blocked_for_tenant() function

-- ============================================================================
-- STEP 1: Drop existing overly permissive RLS policies on blocked_identities
-- ============================================================================

DROP POLICY IF EXISTS "Admins can delete blocked identities" ON public.blocked_identities;
DROP POLICY IF EXISTS "Admins can insert blocked identities" ON public.blocked_identities;
DROP POLICY IF EXISTS "Admins can update blocked identities" ON public.blocked_identities;
DROP POLICY IF EXISTS "Admins can view blocked identities" ON public.blocked_identities;

-- ============================================================================
-- STEP 2: Create tenant-scoped RLS policies for blocked_identities
-- ============================================================================

-- Policy: Users can only view blocked identities for their tenant
CREATE POLICY "Users can view their tenant blocked identities"
ON public.blocked_identities
FOR SELECT
TO authenticated
USING (
  tenant_id IN (
    SELECT au.tenant_id FROM app_users au WHERE au.user_id = auth.uid()
  )
  OR
  -- Super admin can see all (has 'super_admin' in JWT claims)
  (auth.jwt() ->> 'is_super_admin')::boolean = true
);

-- Policy: Users can insert blocked identities for their tenant only
CREATE POLICY "Users can insert blocked identities for their tenant"
ON public.blocked_identities
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IN (
    SELECT au.tenant_id FROM app_users au WHERE au.user_id = auth.uid()
  )
);

-- Policy: Users can update blocked identities for their tenant only
CREATE POLICY "Users can update their tenant blocked identities"
ON public.blocked_identities
FOR UPDATE
TO authenticated
USING (
  tenant_id IN (
    SELECT au.tenant_id FROM app_users au WHERE au.user_id = auth.uid()
  )
)
WITH CHECK (
  tenant_id IN (
    SELECT au.tenant_id FROM app_users au WHERE au.user_id = auth.uid()
  )
);

-- Policy: Users can delete blocked identities for their tenant only
CREATE POLICY "Users can delete their tenant blocked identities"
ON public.blocked_identities
FOR DELETE
TO authenticated
USING (
  tenant_id IN (
    SELECT au.tenant_id FROM app_users au WHERE au.user_id = auth.uid()
  )
);

-- Policy: Allow anon to check blocked identities (needed for booking flow)
CREATE POLICY "Anon can check blocked identities"
ON public.blocked_identities
FOR SELECT
TO anon
USING (true);

-- ============================================================================
-- STEP 3: Create tenant-aware is_identity_blocked_for_tenant function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_identity_blocked_for_tenant(
  p_tenant_id uuid,
  p_identity_number text
)
RETURNS TABLE(is_blocked boolean, block_reason text, identity_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    true AS is_blocked,
    bi.reason AS block_reason,
    bi.identity_type
  FROM blocked_identities bi
  WHERE bi.identity_number = p_identity_number
    AND bi.tenant_id = p_tenant_id
    AND bi.is_active = true
  LIMIT 1;

  -- If no blocked identity found, return not blocked
  IF NOT FOUND THEN
    RETURN QUERY SELECT false::boolean, NULL::text, NULL::text;
  END IF;
END;
$$;

-- Grant execute to authenticated and anon (for booking flow)
GRANT EXECUTE ON FUNCTION public.is_identity_blocked_for_tenant(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_identity_blocked_for_tenant(uuid, text) TO anon;

-- ============================================================================
-- STEP 4: Update block_customer function with tenant validation and audit logging
-- ============================================================================

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
  v_caller_tenant_id uuid;
  v_document_number text;
  v_document_type text;
BEGIN
  -- Get the caller's tenant_id from app_users
  SELECT tenant_id INTO v_caller_tenant_id
  FROM app_users
  WHERE user_id = auth.uid();

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

  -- Validate caller has access to this customer's tenant
  IF v_caller_tenant_id IS NOT NULL AND v_customer.tenant_id != v_caller_tenant_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied: Customer belongs to different tenant');
  END IF;

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
    -- Determine identity type from Veriff document type
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

-- ============================================================================
-- STEP 5: Update unblock_customer function with tenant validation and audit logging
-- ============================================================================

CREATE OR REPLACE FUNCTION public.unblock_customer(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer RECORD;
  v_caller_tenant_id uuid;
BEGIN
  -- Get the caller's tenant_id from app_users
  SELECT tenant_id INTO v_caller_tenant_id
  FROM app_users
  WHERE user_id = auth.uid();

  -- Get customer details
  SELECT c.id, c.name, c.email, c.license_number, c.id_number, c.tenant_id, c.blocked_reason
  INTO v_customer
  FROM customers c
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

  -- Deactivate blocked identities (don't delete - keep history)
  UPDATE blocked_identities
  SET is_active = false,
      updated_at = now()
  WHERE identity_number IN (v_customer.license_number, v_customer.id_number)
    AND tenant_id = v_customer.tenant_id
    AND identity_type IN ('license', 'id_card', 'passport');

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
      'customer_email', v_customer.email
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'message', 'Customer unblocked successfully'
  );
END;
$$;

-- ============================================================================
-- STEP 6: Revoke overly permissive function grants and set proper ones
-- ============================================================================

-- Revoke from anon (these should only be called by authenticated users)
REVOKE ALL ON FUNCTION public.block_customer(uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.unblock_customer(uuid) FROM anon;

-- Grant to authenticated only
GRANT EXECUTE ON FUNCTION public.block_customer(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_customer(uuid) TO authenticated;

-- ============================================================================
-- STEP 7: Add index for faster blocked identity lookups by tenant
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_blocked_identities_tenant_identity
ON public.blocked_identities (tenant_id, identity_number, is_active);

-- ============================================================================
-- Done! Summary of changes:
-- 1. RLS policies now enforce tenant isolation on blocked_identities
-- 2. block_customer() validates tenant access and writes audit logs
-- 3. unblock_customer() validates tenant access and writes audit logs
-- 4. New is_identity_blocked_for_tenant() function for tenant-scoped checks
-- 5. Function grants restricted to authenticated users only
-- 6. Added composite index for faster lookups
-- ============================================================================
