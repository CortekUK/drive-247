-- Create a helper function to check if user can access a rental
-- This function uses SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION public.user_can_access_rental(p_rental_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rentals r
    JOIN public.app_users au ON au.tenant_id = r.tenant_id
    WHERE r.id = p_rental_id
    AND au.auth_user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.app_users au
    WHERE au.auth_user_id = auth.uid()
    AND au.is_super_admin = true
  )
  -- Also check if the user's JWT has impersonated_tenant_id matching the rental
  OR EXISTS (
    SELECT 1 FROM public.rentals r
    WHERE r.id = p_rental_id
    AND r.tenant_id = COALESCE(
      (auth.jwt() -> 'user_metadata' ->> 'impersonated_tenant_id')::uuid,
      (SELECT tenant_id FROM public.app_users WHERE auth_user_id = auth.uid() LIMIT 1)
    )
  );
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.user_can_access_rental(uuid) TO authenticated;

-- Drop existing policies
DROP POLICY IF EXISTS "ledger_select_policy" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "ledger_insert_policy" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "ledger_update_policy" ON "public"."ledger_entries";
DROP POLICY IF EXISTS "ledger_delete_policy" ON "public"."ledger_entries";

-- Create SELECT policy using the helper function
CREATE POLICY "ledger_select_policy" ON "public"."ledger_entries"
FOR SELECT TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR tenant_id IS NULL
  OR public.is_super_admin()
  OR public.user_can_access_rental(rental_id)
);

-- INSERT policy
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
