-- Finance Sync — Sprint 3: seed default mappings on first connect.
-- Spec §8.2 — when a tenant connects Xero/Zoho for the first time we pre-fill
-- the mapping table with sensible defaults based on a typical car rental
-- business. Operator hits "Save mappings" on the screen pre-filled.
--
-- The OAuth callback calls this function right after the accounting_connections
-- row is upserted. Idempotent: if a row already exists for (tenant, provider,
-- event_type) we leave it alone.

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
  v_country TEXT;
  v_is_uk BOOLEAN;
  v_default_tax_xero TEXT;          -- 'OUTPUT2' for UK, NULL elsewhere
  v_default_tax_zoho TEXT;          -- per-org UUID — we leave NULL and the operator picks via the UI
  /** Sales account code differs per provider:
   *   Xero default chart of accounts uses '200' (Sales).
   *   Zoho default uses string 'Sales'.
   */
  v_sales_code TEXT;
  v_other_revenue_code TEXT;
BEGIN
  -- Resolve country to set the default UK VAT mapping (per master plan
  -- Deviation #5 — UK is the default tenant locale today).
  SELECT COALESCE(country, currency_code), currency_code
    INTO v_country, v_country
    FROM public.tenants WHERE id = p_tenant_id;
  v_is_uk := (
    v_country IS NOT NULL AND (
      upper(v_country) IN ('UK', 'GB', 'GBR', 'GBP', 'UNITED KINGDOM')
    )
  );

  IF p_provider = 'xero' THEN
    v_sales_code := '200';
    v_other_revenue_code := '260';
    v_default_tax_xero := CASE WHEN v_is_uk THEN 'OUTPUT2' ELSE NULL END;
  ELSE
    v_sales_code := 'Sales';
    v_other_revenue_code := 'Other Income';
    v_default_tax_zoho := NULL;
  END IF;

  -- Insert the per-event-type defaults from spec §8.2.
  WITH defaults(event_type, code, tax) AS (
    VALUES
      ('rental_charge'::public.financial_event_type,     v_sales_code,         COALESCE(v_default_tax_xero, v_default_tax_zoho)),
      ('insurance_charge'::public.financial_event_type,  v_other_revenue_code, COALESCE(v_default_tax_xero, v_default_tax_zoho)),
      ('damage_charge'::public.financial_event_type,     v_other_revenue_code, COALESCE(v_default_tax_xero, v_default_tax_zoho)),
      ('mileage_charge'::public.financial_event_type,    v_other_revenue_code, COALESCE(v_default_tax_xero, v_default_tax_zoho)),
      ('late_fee'::public.financial_event_type,          v_other_revenue_code, NULL),                                            -- spec §8.2: no VAT on late fees
      ('charging_cost'::public.financial_event_type,     v_sales_code,         COALESCE(v_default_tax_xero, v_default_tax_zoho)),
      ('extension_charge'::public.financial_event_type,  v_sales_code,         COALESCE(v_default_tax_xero, v_default_tax_zoho)),
      ('deposit_capture'::public.financial_event_type,   v_other_revenue_code, NULL),                                            -- deposits are typically zero-rated
      ('discount'::public.financial_event_type,          v_sales_code,         COALESCE(v_default_tax_xero, v_default_tax_zoho))
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

REVOKE ALL ON FUNCTION public.seed_default_accounting_mappings(UUID, public.accounting_provider) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_accounting_mappings(UUID, public.accounting_provider) TO service_role;

COMMENT ON FUNCTION public.seed_default_accounting_mappings IS
  'Idempotent seed of spec §8.2 defaults. Called from the OAuth callback right after a tenant first connects. Returns the number of rows inserted (0 if all defaults already exist).';
