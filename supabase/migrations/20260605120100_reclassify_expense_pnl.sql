-- ============================================================
-- M1: Reflow historical P&L when an expense category's bucket changes.
-- The handle_vehicle_expense_pnl() trigger only fires on expense insert/update,
-- so reclassifying a category (e.g. Fuel: Expenses -> Service) used to leave all
-- past expenses on the old bucket in pnl_entries. This function re-stamps the
-- bucket on every pnl_entry tied to the given tenant + category name.
--
-- pnl_entries.category stores the *bucket* (Service/Expenses), and rows are
-- linked back to the expense via reference = 'vexp:{expense_id}'.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reclassify_expense_pnl(
  p_tenant_id uuid,
  p_category  text,
  p_bucket    text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  affected integer;
BEGIN
  -- Authorize: caller must belong to this tenant (or be a super admin).
  IF p_tenant_id <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized for this tenant';
  END IF;

  IF p_bucket NOT IN ('Service', 'Expenses') THEN
    RAISE EXCEPTION 'Invalid P&L bucket: %', p_bucket;
  END IF;

  UPDATE public.pnl_entries pe
  SET category = p_bucket
  FROM public.vehicle_expenses ve
  WHERE pe.reference = 'vexp:' || ve.id::text
    AND ve.tenant_id = p_tenant_id
    AND ve.category = p_category
    AND pe.category IS DISTINCT FROM p_bucket;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reclassify_expense_pnl(uuid, text, text) TO authenticated;
