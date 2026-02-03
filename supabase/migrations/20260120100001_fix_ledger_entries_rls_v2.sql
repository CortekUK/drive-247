-- Fix ledger_entries RLS - ensure it's properly configured
-- This migration ensures RLS is enabled and policies are correctly set

-- First, ensure RLS is enabled
ALTER TABLE "public"."ledger_entries" ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies to start fresh
DROP POLICY IF EXISTS "tenant_isolation_ledger_entries" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "tenant_isolation_ledger_entries_insert" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "tenant_isolation_ledger_entries_update" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "tenant_isolation_ledger_entries_delete" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "Allow all operations for app users" ON "public"."ledger_entries";

-- Create a permissive SELECT policy that allows:
-- 1. Entries where tenant_id matches the user's tenant
-- 2. Entries where tenant_id is NULL (for legacy data)
-- 3. Super admins can see everything
CREATE POLICY "ledger_entries_select" ON "public"."ledger_entries"
FOR SELECT
USING (
  ("tenant_id" = "public"."get_user_tenant_id"())
  OR ("tenant_id" IS NULL)
  OR "public"."is_super_admin"()
);

-- INSERT policy - allow authenticated users to insert for their tenant
CREATE POLICY "ledger_entries_insert" ON "public"."ledger_entries"
FOR INSERT
WITH CHECK (
  ("tenant_id" = "public"."get_user_tenant_id"())
  OR ("tenant_id" IS NULL)
  OR "public"."is_super_admin"()
);

-- UPDATE policy
CREATE POLICY "ledger_entries_update" ON "public"."ledger_entries"
FOR UPDATE
USING (
  ("tenant_id" = "public"."get_user_tenant_id"())
  OR ("tenant_id" IS NULL)
  OR "public"."is_super_admin"()
)
WITH CHECK (
  ("tenant_id" = "public"."get_user_tenant_id"())
  OR ("tenant_id" IS NULL)
  OR "public"."is_super_admin"()
);

-- DELETE policy
CREATE POLICY "ledger_entries_delete" ON "public"."ledger_entries"
FOR DELETE
USING (
  ("tenant_id" = "public"."get_user_tenant_id"())
  OR ("tenant_id" IS NULL)
  OR "public"."is_super_admin"()
);
