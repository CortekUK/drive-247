-- Migration: Add scheduled lockbox code sending
-- Supports auto-send of lockbox details at a configurable offset before rental start

-- 1. Add lockbox send timing setting to tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS lockbox_send_offset_minutes integer DEFAULT NULL;

COMMENT ON COLUMN public.tenants.lockbox_send_offset_minutes IS 'Minutes before rental start to auto-send lockbox code. NULL = manual only. 0 = at start time.';

-- 2. Add lockbox_sent_at to rentals to track if/when auto-send fired
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS lockbox_sent_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.rentals.lockbox_sent_at IS 'Timestamp when lockbox code was auto-sent to customer. NULL = not yet sent.';

-- 3. Create lockbox_send_log table for audit trail
CREATE TABLE IF NOT EXISTS public.lockbox_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('scheduled', 'sent', 'resent', 'rescheduled', 'failed')),
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms', 'whatsapp')),
  scheduled_for timestamptz,
  sent_by uuid REFERENCES auth.users(id),
  sent_by_name text,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lockbox_send_log IS 'Audit log for lockbox code send events';

ALTER TABLE public.lockbox_send_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant users can view their lockbox send logs" ON public.lockbox_send_log;
CREATE POLICY "Tenant users can view their lockbox send logs"
  ON public.lockbox_send_log FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Service role can manage lockbox send logs" ON public.lockbox_send_log;
CREATE POLICY "Service role can manage lockbox send logs"
  ON public.lockbox_send_log FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_lockbox_send_log_rental
  ON public.lockbox_send_log(rental_id);

CREATE INDEX IF NOT EXISTS idx_lockbox_send_log_tenant
  ON public.lockbox_send_log(tenant_id);

CREATE INDEX IF NOT EXISTS idx_rentals_lockbox_pending
  ON public.rentals(tenant_id, delivery_method, lockbox_sent_at)
  WHERE delivery_method = 'lockbox' AND lockbox_sent_at IS NULL;
