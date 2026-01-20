-- Fix ledger_entries RLS - allow reading entries based on rental ownership
-- The issue is the get_user_tenant_id() function may not be returning the expected value

-- Drop all existing policies on ledger_entries
DROP POLICY IF EXISTS "ledger_select_policy" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "ledger_insert_policy" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "ledger_update_policy" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "ledger_delete_policy" ON "public"."ledger_entries";

-- Ensure RLS is enabled
ALTER TABLE "public"."ledger_entries" ENABLE ROW LEVEL SECURITY;

-- Create a SELECT policy that allows reading if:
-- 1. User's tenant_id matches the entry's tenant_id
-- 2. Entry's tenant_id is NULL
-- 3. User is super admin
-- 4. The entry's rental belongs to user's tenant (join check)
CREATE POLICY "ledger_select_policy" ON "public"."ledger_entries"
FOR SELECT TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR tenant_id IS NULL
  OR public.is_super_admin()
  OR EXISTS (
    SELECT 1 FROM public.rentals r
    WHERE r.id = rental_id
    AND r.tenant_id = public.get_user_tenant_id()
  )
);

-- INSERT policy - allow if tenant_id matches or is null
CREATE POLICY "ledger_insert_policy" ON "public"."ledger_entries"
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  OR tenant_id IS NULL
  OR public.is_super_admin()
);

-- UPDATE policy
CREATE POLICY "ledger_update_policy" ON "public"."ledger_entries"
FOR UPDATE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR tenant_id IS NULL
  OR public.is_super_admin()
)
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  OR tenant_id IS NULL
  OR public.is_super_admin()
);

-- DELETE policy
CREATE POLICY "ledger_delete_policy" ON "public"."ledger_entries"
FOR DELETE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR tenant_id IS NULL
  OR public.is_super_admin()
);
