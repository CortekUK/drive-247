-- Finance Sync — Sprint 3: customer → provider contact mapping.
-- The sync worker creates a Contact in Xero/Zoho the first time we push a
-- financial event for a customer, then records that external contact id here.
-- Every subsequent event for the same customer reuses this id — no duplicate
-- contacts in the operator's accounting system.
--
-- Spec §5.5 + §7.3 (idempotency).

CREATE TABLE IF NOT EXISTS public.accounting_contact_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  provider public.accounting_provider NOT NULL,

  /** The Xero ContactID or Zoho contact_id. */
  external_contact_id TEXT NOT NULL,

  /** Cached display name for the sync log UI — refreshed when customer changes. */
  external_contact_name TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One link per (tenant, provider, customer) — the dedupe key.
CREATE UNIQUE INDEX accounting_contact_links_uniq
  ON public.accounting_contact_links (tenant_id, provider, customer_id);

-- Lookup hot path used by ensureContact() in the sync worker.
CREATE INDEX accounting_contact_links_customer_idx
  ON public.accounting_contact_links (customer_id, provider);

CREATE TRIGGER set_accounting_contact_links_updated_at
  BEFORE UPDATE ON public.accounting_contact_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.accounting_contact_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_staff_read_accounting_contact_links"
  ON public.accounting_contact_links
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY "service_role_full_access_accounting_contact_links"
  ON public.accounting_contact_links
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.accounting_contact_links IS
  'Maps Drive247 customers → provider contact IDs so the sync worker doesn''t create duplicate contacts on every invoice. Spec §5.5.';
