-- Fix tenant isolation policy for org_settings
-- The issue is that tenant_isolation policy conflicts with the allow all policy

-- First, let's check what get_user_tenant_id() returns
SELECT
  get_user_tenant_id() as user_tenant_id,
  auth.uid() as current_user_id;

-- Check if org_settings has a tenant_id that matches
SELECT id, tenant_id, company_name FROM org_settings;

-- The problem: org_settings should NOT have tenant isolation
-- because it's a single global settings table for the entire organization
-- We need to remove the tenant_isolation policy

DROP POLICY IF EXISTS "tenant_isolation_org_settings_read" ON org_settings;

-- Also remove the super_admin_update policy since we already have "Allow authenticated users full access"
DROP POLICY IF EXISTS "super_admin_update_org_settings" ON org_settings;

-- Verify the remaining policies
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'org_settings';
