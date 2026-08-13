-- Finance Sync — Sprint 3 patch: tenants table has no `country` column.
-- The seed function in 20260526120200 referenced a non-existent column.
-- Switch to detecting "UK locale" by currency_code = 'GBP' only, which is
-- what the master plan called out (Deviation #5).
CREATE OR REPLACE FUNCTION public.seed_default_accounting_mappings(
  p_tenant_id UUID,
  p_provider public.accounting_provider
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER := 0;
  v_currency TEXT;
  v_is_uk BOOLEAN;
  v_default_tax TEXT;
  v_sales_code TEXT;
  v_other_revenue_code TEXT;
BEGIN
  SELECT currency_code INTO v_currency FROM public.tenants WHERE id = p_tenant_id;
  v_is_uk := (v_currency IS NOT NULL AND upper(v_currency) = 'GBP');

  IF p_provider = 'xero' THEN
    v_sales_code := '200';
    v_other_revenue_code := '260';
    v_default_tax := CASE WHEN v_is_uk THEN 'OUTPUT2' ELSE NULL END;
  ELSE
    v_sales_code := 'Sales';
    v_other_revenue_code := 'Other Income';
    v_default_tax := NULL;  -- Zoho uses per-org UUIDs, operator must pick via UI
  END IF;

  WITH defaults(event_type, code, tax) AS (
    VALUES
      ('rental_charge'::public.financial_event_type,     v_sales_code,         v_default_tax),
      ('insurance_charge'::public.financial_event_type,  v_other_revenue_code, v_default_tax),
      ('damage_charge'::public.financial_event_type,     v_other_revenue_code, v_default_tax),
      ('mileage_charge'::public.financial_event_type,    v_other_revenue_code, v_default_tax),
      ('late_fee'::public.financial_event_type,          v_other_revenue_code, NULL::TEXT),
      ('charging_cost'::public.financial_event_type,     v_sales_code,         v_default_tax),
      ('extension_charge'::public.financial_event_type,  v_sales_code,         v_default_tax),
      ('deposit_capture'::public.financial_event_type,   v_other_revenue_code, NULL::TEXT),
      ('discount'::public.financial_event_type,          v_sales_code,         v_default_tax)
  )
  INSERT INTO public.accounting_account_mappings
    (tenant_id, provider, event_type, external_account_code, external_tax_code, is_default)
  SELECT p_tenant_id, p_provider, d.event_type, d.code, d.tax, true
    FROM defaults d
   WHERE NOT EXISTS (
     SELECT 1 FROM public.accounting_account_mappings
      WHERE tenant_id = p_tenant_id AND provider = p_provider AND event_type = d.event_type
   );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN v_inserted;
END;
$$;
