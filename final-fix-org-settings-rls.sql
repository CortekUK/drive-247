-- ============================================
-- FINAL FIX: Remove Conflicting RLS Policies
-- ============================================
-- This script removes the conflicting tenant isolation and super admin policies
-- that are preventing Settings page from loading
-- ============================================

-- Remove the tenant isolation policy (org_settings is global, not tenant-specific)
DROP POLICY IF EXISTS "tenant_isolation_org_settings_read" ON org_settings;

-- Remove the super admin update policy (conflicts with authenticated full access)
DROP POLICY IF EXISTS "super_admin_update_org_settings" ON org_settings;

-- Verify only 2 policies remain:
-- 1. Allow anon users read access to org_settings
-- 2. Allow authenticated users full access to org_settings
SELECT
  policyname,
  cmd,
  roles::text,
  CASE
    WHEN policyname = 'Allow anon users read access to org_settings' THEN '✅ Correct (anon read)'
    WHEN policyname = 'Allow authenticated users full access to org_settings' THEN '✅ Correct (authenticated all)'
    ELSE '⚠️  Unexpected policy'
  END as status
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'org_settings'
ORDER BY policyname;
