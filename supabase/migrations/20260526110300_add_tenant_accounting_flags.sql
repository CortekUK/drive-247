-- Finance Sync — Sprint 2: per-tenant integration flags.
-- Mirror of the existing integration_tesla_fleet / integration_bonzah pattern.
-- These flip to TRUE when the OAuth callback successfully establishes the
-- connection and FALSE when the disconnect-accounting fn runs. Drives the
-- "Connected" pill in Settings → Accounting and the sidebar nav state.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS integration_xero BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS integration_zoho_books BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.tenants.integration_xero IS
  'TRUE when the tenant has an active accounting_connections row for provider=xero.';
COMMENT ON COLUMN public.tenants.integration_zoho_books IS
  'TRUE when the tenant has an active accounting_connections row for provider=zoho.';
