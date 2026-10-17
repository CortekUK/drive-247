-- APPLIED to production 2026-10-17
--
-- Accounting sync v2 — one set of books belongs to one company.
--
-- A Xero organisation / Zoho Books organisation can be live on only ONE
-- tenant's connection at a time. Two tenants writing into the same books would
-- mix their customers and money. The connect flow already refuses a taken
-- organisation (connect.ts: takenOrgIds / OrgTakenError); this index is the
-- last word if two tenants race for the same books.
--
-- Only live connections count: once a tenant disconnects, the organisation is
-- free for another tenant to connect.

CREATE UNIQUE INDEX IF NOT EXISTS accounting_v2_connections_one_tenant_per_org
  ON public.accounting_v2_connections (provider, external_org_id)
  WHERE external_org_id IS NOT NULL AND status IN ('connected', 'needs_reauth', 'error');
