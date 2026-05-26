-- Finance Sync — Sprint 1: Phase 2 schema forward-compatibility.
-- Spec §15.3 — webhooks land in Phase 2+, but these columns land NOW so the
-- schema is forward-compatible. Once Xero/Zoho INVOICE.UPDATE webhooks are
-- wired, `external_invoice_paid_at` gets populated when the provider marks
-- an invoice PAID and the customer's payment lands in their bank rec — which
-- in turn lets us light up "this invoice is paid in books" badges in the UI.
ALTER TABLE public.financial_event_sync_state
  ADD COLUMN IF NOT EXISTS external_invoice_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS external_status TEXT;

COMMENT ON COLUMN public.financial_event_sync_state.external_invoice_paid_at IS
  'Set by INVOICE.UPDATE webhook when provider marks invoice PAID (Phase 2+).';
COMMENT ON COLUMN public.financial_event_sync_state.external_status IS
  'Provider-side status snapshot from webhook payload (Phase 2+).';
