-- Finance Sync (Xero & Zoho) — Sprint 1: financial_events internal ledger.
-- This table is the bridge between Drive247's operational tables and the
-- accounting sync layer. Every chargeable, refundable, or accountable thing
-- that happens in Drive247 generates exactly one row here. The sync layer
-- reads ONLY from this table — never from rental_charges, payments, or
-- ledger_entries directly (spec §2.3).
--
-- See docs/XERO_ZOHO_FINANCE_SYNC_GUIDE.pdf §5.2 + Confirmed Decision D4
-- (payment_receipt is its own event type, separate from rental_charge).

CREATE TYPE public.financial_event_type AS ENUM (
  'rental_charge',          -- standard rental fee — invoice line
  'payment_receipt',        -- customer paid; sync layer calls recordPayment on the open invoice (D4)
  'deposit_capture',        -- captured security deposit — invoice line with deposit flag
  'security_hold_release',  -- preauth released — no-op for sync (kept for audit)
  'insurance_charge',       -- Bonzah / other insurance line
  'late_fee',               -- late return fee
  'mileage_charge',         -- excess mileage charge
  'damage_charge',          -- damage assessed and added to ledger
  'charging_cost',          -- Tesla supercharger pass-through
  'extension_charge',       -- rental extension — always creates its own invoice (spec §8.3)
  'refund',                 -- refund completed — sync layer creates credit note
  'discount',               -- discount applied — invoice line with negative amount
  'maintenance_expense',    -- per-vehicle cost (Phase 2+ for sync; lands now for profitability dashboard)
  'partner_payout'          -- co-host payout (Phase 2+ for sync; lands now for forward compat)
);

CREATE TYPE public.financial_event_status AS ENUM ('open', 'finalised', 'voided');

CREATE TABLE IF NOT EXISTS public.financial_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- What this event relates to (any subset may be NULL for tenant-level events
  -- like maintenance_expense not tied to a rental)
  rental_id UUID REFERENCES public.rentals(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,

  -- The money. amount_cents is signed: negative for refunds + discounts.
  event_type public.financial_event_type NOT NULL,
  amount_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,                  -- always tenant.currency_code at time of event
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Lifecycle. Once 'finalised' the row should never be edited (only voided).
  status public.financial_event_status NOT NULL DEFAULT 'finalised',

  -- Where the event came from in the operational data — used for dedupe.
  source_table TEXT,                       -- e.g. 'payments', 'ledger_entries', 'rental_extensions'
  source_id UUID,

  -- Free-form context (vehicle reg, rental ref, line description, etc.)
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_financial_events_tenant_occurred ON public.financial_events(tenant_id, occurred_at DESC);
CREATE INDEX idx_financial_events_rental ON public.financial_events(rental_id) WHERE rental_id IS NOT NULL;
CREATE INDEX idx_financial_events_vehicle ON public.financial_events(vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_financial_events_customer ON public.financial_events(customer_id) WHERE customer_id IS NOT NULL;

-- Dedupe key — the same source_table + source_id should not produce two events.
-- We don't make this UNIQUE because some operational rows legitimately spawn
-- multiple events (e.g. a payment that's both a payment_receipt AND, on
-- refund_status flip, a refund). Index supports the dedupe lookup at insert time.
CREATE INDEX idx_financial_events_source ON public.financial_events(source_table, source_id)
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL;

CREATE TRIGGER set_financial_events_updated_at
  BEFORE UPDATE ON public.financial_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.financial_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_staff_read_financial_events" ON public.financial_events
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- All writes flow through enqueue_financial_event() RPC running as service_role.
-- No tenant-side INSERT/UPDATE/DELETE policies on purpose.
CREATE POLICY "service_role_full_access_financial_events" ON public.financial_events
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.financial_events IS
  'Internal ledger feeding the accounting sync layer. Bridge between Drive247 operational tables and Xero/Zoho. Spec §5.2.';
