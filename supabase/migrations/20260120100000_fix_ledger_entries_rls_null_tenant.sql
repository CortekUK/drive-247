-- Fix ledger_entries RLS to allow reading entries with NULL tenant_id
-- This is needed because refund entries may be created with NULL tenant_id in some cases

-- Ensure RLS is enabled on ledger_entries
ALTER TABLE "public"."ledger_entries" ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies on ledger_entries to ensure clean state
DROP POLICY IF EXISTS "tenant_isolation_ledger_entries" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "tenant_isolation_ledger_entries_insert" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "tenant_isolation_ledger_entries_update" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "tenant_isolation_ledger_entries_delete" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "Allow all operations for app users" ON "public"."ledger_entries";

-- Create updated policy that allows NULL tenant_id for SELECT
-- For SELECT: Allow if tenant_id matches OR tenant_id is NULL OR user is super admin
-- For INSERT/UPDATE/DELETE: Keep strict tenant_id matching (no NULL)
CREATE POLICY "tenant_isolation_ledger_entries" ON "public"."ledger_entries"
FOR SELECT
USING (
  ("tenant_id" = "public"."get_user_tenant_id"())
  OR ("tenant_id" IS NULL)
  OR "public"."is_super_admin"()
);

-- Separate policy for INSERT
CREATE POLICY "tenant_isolation_ledger_entries_insert" ON "public"."ledger_entries"
FOR INSERT
WITH CHECK (
  ("tenant_id" = "public"."get_user_tenant_id"())
  OR "public"."is_super_admin"()
);

-- Separate policy for UPDATE
CREATE POLICY "tenant_isolation_ledger_entries_update" ON "public"."ledger_entries"
FOR UPDATE
USING (
  ("tenant_id" = "public"."get_user_tenant_id"())
  OR "public"."is_super_admin"()
)
WITH CHECK (
  ("tenant_id" = "public"."get_user_tenant_id"())
  OR "public"."is_super_admin"()
);

-- Separate policy for DELETE
CREATE POLICY "tenant_isolation_ledger_entries_delete" ON "public"."ledger_entries"
FOR DELETE
USING (
  ("tenant_id" = "public"."get_user_tenant_id"())
  OR "public"."is_super_admin"()
);
