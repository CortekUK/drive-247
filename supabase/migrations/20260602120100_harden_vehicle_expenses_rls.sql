-- Enable RLS on vehicle_expenses (was never enabled despite having a policy)
-- and replace the blanket allow-all policy with tenant-scoped policies that
-- match the rest of the schema. App code already filters by tenant_id.

ALTER TABLE public.vehicle_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations for app users on vehicle_expenses" ON public.vehicle_expenses;

DROP POLICY IF EXISTS "tenant read vehicle_expenses" ON public.vehicle_expenses;
CREATE POLICY "tenant read vehicle_expenses"
  ON public.vehicle_expenses FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "tenant manage vehicle_expenses" ON public.vehicle_expenses;
CREATE POLICY "tenant manage vehicle_expenses"
  ON public.vehicle_expenses FOR ALL
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "service_role manage vehicle_expenses" ON public.vehicle_expenses;
CREATE POLICY "service_role manage vehicle_expenses"
  ON public.vehicle_expenses FOR ALL
  TO service_role USING (true) WITH CHECK (true);
