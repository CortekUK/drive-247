# Fix RLS Policies for org_settings Table

## Problem
The Settings page at `localhost:3001/settings` is showing an error because there are **conflicting RLS policies** on the `org_settings` table.

## Current State (4 policies)
1. ✅ `Allow anon users read access to org_settings` - Correct
2. ✅ `Allow authenticated users full access to org_settings` - Correct
3. ❌ `super_admin_update_org_settings` - Conflicts with #2
4. ❌ `tenant_isolation_org_settings_read` - Blocks access (checks tenant_id but org_settings is global)

## Solution
Run the SQL below in **Supabase SQL Editor** to remove the conflicting policies:

```sql
-- Remove the tenant isolation policy (org_settings is global, not tenant-specific)
DROP POLICY IF EXISTS "tenant_isolation_org_settings_read" ON org_settings;

-- Remove the super admin update policy (conflicts with authenticated full access)
DROP POLICY IF EXISTS "super_admin_update_org_settings" ON org_settings;

-- Verify only 2 policies remain
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
```

## Steps to Execute

1. Open Supabase dashboard: https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo
2. Go to **SQL Editor**
3. Paste the SQL above
4. Click **Run**
5. You should see 2 rows with ✅ status

## After Running the Fix

1. Reload Settings page at `localhost:3001/settings`
2. Verify the page loads without error
3. Test changing FleetVana's branding colors (change primary color to #3B82F6 - blue)
4. Test that Global Motion Transport's branding stays default (gold #C6A256)

## Why This Fixes the Issue

The `tenant_isolation_org_settings_read` policy was checking:
```sql
(tenant_id = get_user_tenant_id()) OR is_super_admin()
```

But `org_settings` is a **global configuration table**, not tenant-specific. Every user needs access to it regardless of their tenant_id. The policy "Allow authenticated users full access" already provides the correct access control.
