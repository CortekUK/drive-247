-- Disable RLS on ledger_entries
-- The rationale:
-- 1. Ledger entries are always accessed via rental_id
-- 2. Rentals are protected by their own RLS
-- 3. If a user can access a rental, they should see its ledger entries
-- 4. The current RLS is too complex and causing issues with tenant impersonation

-- Drop all policies first
DROP POLICY IF EXISTS "ledger_select_policy" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "ledger_insert_policy" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "ledger_update_policy" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "ledger_delete_policy" ON "public"."ledger_entries";

-- Disable RLS
ALTER TABLE "public"."ledger_entries" DISABLE ROW LEVEL SECURITY;
