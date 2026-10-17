-- APPLIED to production 2026-10-17
--
-- Accounting sync v2 — one accounting integration per company.
--
-- A company connects Xero OR Zoho Books, never both: every transaction lands
-- in one set of books. The other provider counts while it is live or
-- mid-connect (pending_org); disconnecting it frees the company to switch.
-- The portal, the `start` action, both OAuth callbacks and finalizeOrg refuse
-- a second provider (connect.ts: otherProviderLive / OtherProviderError); this
-- index is the last word on a race.

CREATE UNIQUE INDEX IF NOT EXISTS accounting_v2_connections_one_provider_per_tenant
  ON public.accounting_v2_connections (tenant_id)
  WHERE status IN ('connected', 'needs_reauth', 'error', 'pending_org');
