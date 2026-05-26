-- Finance Sync — Sprint 3: per-tenant event-type → provider account/tax mapping.
-- This is the row the sync worker reads to know "for a damage_charge event,
-- which Xero account code + tax type should I use?". The operator configures
-- this on the Settings → Accounting → Configure Mappings screen.
--
-- Spec §5.4 + §8.2 (defaults) + §13.1.

CREATE TABLE IF NOT EXISTS public.accounting_account_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider public.accounting_provider NOT NULL,

  /**
   * What this mapping is for. NULL `event_type` is used for a special
   * sentinel row carrying the bank/clearing payment account — see the
   * is_payment_account_sentinel column.
   *
   * The CHECK constraint enforces "either event_type is set OR the sentinel
   * row is — never both, never neither".
   */
  event_type public.financial_event_type,
  is_payment_account_sentinel BOOLEAN NOT NULL DEFAULT FALSE,

  external_account_code TEXT NOT NULL,
  external_account_name TEXT,              -- denormalised for UI label rendering
  external_tax_code TEXT,                  -- Xero TaxType code (e.g. 'OUTPUT2') or Zoho tax UUID
  external_tax_rate NUMERIC(6,3),          -- Zoho persists the percent here for display

  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT one_kind_of_mapping CHECK (
    (event_type IS NOT NULL AND is_payment_account_sentinel = FALSE) OR
    (event_type IS NULL AND is_payment_account_sentinel = TRUE)
  )
);

-- Unique on (tenant, provider, event_type) — one mapping per event type per provider
CREATE UNIQUE INDEX accounting_account_mappings_event_uniq
  ON public.accounting_account_mappings (tenant_id, provider, event_type)
  WHERE event_type IS NOT NULL;

-- Exactly one payment-account sentinel row per (tenant, provider)
CREATE UNIQUE INDEX accounting_account_mappings_payment_acct_uniq
  ON public.accounting_account_mappings (tenant_id, provider)
  WHERE is_payment_account_sentinel = TRUE;

CREATE INDEX accounting_account_mappings_tenant_idx
  ON public.accounting_account_mappings (tenant_id, provider);

CREATE TRIGGER set_accounting_account_mappings_updated_at
  BEFORE UPDATE ON public.accounting_account_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.accounting_account_mappings ENABLE ROW LEVEL SECURITY;

-- Tenant staff can read their own mappings.
CREATE POLICY "tenant_staff_read_accounting_account_mappings"
  ON public.accounting_account_mappings
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- All writes through the save-accounting-mappings edge fn running as service_role.
CREATE POLICY "service_role_full_access_accounting_account_mappings"
  ON public.accounting_account_mappings
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.accounting_account_mappings IS
  'Per-tenant per-provider mapping: Drive247 financial_event_type → provider account code + tax code. One row per event type (event_type NOT NULL) plus one sentinel row per provider (is_payment_account_sentinel=true) holding the bank/clearing account for payment receipts. Spec §5.4.';
