-- Finance Sync — Sprint 1: sync state machine.
-- One row per (financial_event, provider). A tenant connected to BOTH Xero
-- and Zoho gets two sync_state rows per event (spec §2.4 — both sync
-- independently, both succeed independently).
--
-- See docs/XERO_ZOHO_FINANCE_SYNC_GUIDE.pdf §5.3 + §14 (state machine + errors).

CREATE TYPE public.accounting_provider AS ENUM ('xero', 'zoho');

CREATE TYPE public.sync_state AS ENUM (
  'pending',  -- just enqueued, awaiting next cron tick
  'syncing',  -- worker has claimed it and is mid-flight
  'synced',   -- successful — external_invoice_id populated, terminal state
  'failed',   -- error class transient/unknown — retry per backoff schedule
  'skipped'   -- operator marked "do not sync" from the failed-row drawer (manual override)
);

CREATE TABLE IF NOT EXISTS public.financial_event_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_event_id UUID NOT NULL REFERENCES public.financial_events(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider public.accounting_provider NOT NULL,
  state public.sync_state NOT NULL DEFAULT 'pending',

  -- Idempotency keys — populated as the sync progresses. Used at insert time
  -- in xero-client.ts / zoho-client.ts to short-circuit duplicate writes.
  external_invoice_id TEXT,
  external_payment_id TEXT,
  external_credit_note_id TEXT,
  external_contact_id TEXT,

  -- Retry bookkeeping — backoff schedule is 1m, 5m, 30m, 2h, 12h, dead-letter
  -- (spec §9.1). After dead-letter the row stays 'failed' and only manual retry
  -- from the UI re-queues it.
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,             -- when worker should pick this up again
  last_error TEXT,
  last_error_code TEXT,                    -- maps to error class (transient|auth|validation|duplicate|unknown)

  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One sync row per (event, provider). Re-enqueueing the same event for the
-- same provider does nothing.
CREATE UNIQUE INDEX financial_event_sync_state_uniq
  ON public.financial_event_sync_state (financial_event_id, provider);

-- Worker query hot path — pick pending/failed rows whose next_attempt_at has
-- arrived (or is null = first-time pending).
CREATE INDEX financial_event_sync_state_pending_idx
  ON public.financial_event_sync_state (state, next_attempt_at)
  WHERE state IN ('pending', 'failed');

CREATE INDEX financial_event_sync_state_tenant_idx
  ON public.financial_event_sync_state (tenant_id, provider, state, created_at DESC);

CREATE TRIGGER set_financial_event_sync_state_updated_at
  BEFORE UPDATE ON public.financial_event_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.financial_event_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_staff_read_sync_state" ON public.financial_event_sync_state
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY "service_role_full_access_sync_state" ON public.financial_event_sync_state
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.financial_event_sync_state IS
  'Per-event-per-provider sync state machine. Spec §5.3 + §14.';
