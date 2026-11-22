-- Rollback for 20261114150000_bonzah_policies_rls.sql: back to RLS off, as before.
ALTER TABLE public.bonzah_insurance_policies DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff can update tenant policies" ON public.bonzah_insurance_policies;
DROP POLICY IF EXISTS "Super admins can read all bonzah policies" ON public.bonzah_insurance_policies;
