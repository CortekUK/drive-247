-- Auto-Extension Control Center: reminder log + cadence config.
-- Foundation for the full management panel (manual reminders, calendar, frequency,
-- exact recipient + paid-through-link tracking, email preview). Additive only.

-- ---------------------------------------------------------------------------
-- 1. Reminder cadence config on the rental (nudges for unpaid pay-links)
-- ---------------------------------------------------------------------------
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS auto_extend_reminder_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_extend_reminder_interval_days integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS auto_extend_reminder_max integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS auto_extend_reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_extend_last_reminder_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rentals_auto_extend_reminder_interval_check') THEN
    ALTER TABLE public.rentals ADD CONSTRAINT rentals_auto_extend_reminder_interval_check
      CHECK (auto_extend_reminder_interval_days >= 1 AND auto_extend_reminder_interval_days <= 30);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rentals_auto_extend_reminder_max_check') THEN
    ALTER TABLE public.rentals ADD CONSTRAINT rentals_auto_extend_reminder_max_check
      CHECK (auto_extend_reminder_max >= 0 AND auto_extend_reminder_max <= 20);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Per-message reminder log (one row per email/SMS actually sent)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auto_extension_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  extension_id uuid REFERENCES public.rental_extensions(id) ON DELETE SET NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- pay_link (first link for a week) | nudge (follow-up while unpaid) |
  -- manual (admin-triggered) | auto_charge_receipt (card charged automatically)
  reminder_type text NOT NULL DEFAULT 'pay_link'
    CHECK (reminder_type IN ('pay_link','nudge','manual','auto_charge_receipt')),
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms')),
  recipient text,
  subject text,
  amount numeric(12,2),
  stripe_checkout_session_id text,
  -- sent | failed | paid (flipped when the linked payment lands)
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed','paid')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  error_message text,
  sent_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_ext_reminders_rental ON public.auto_extension_reminders(rental_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_ext_reminders_extension ON public.auto_extension_reminders(extension_id) WHERE extension_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auto_ext_reminders_tenant ON public.auto_extension_reminders(tenant_id);

-- ---------------------------------------------------------------------------
-- 3. RLS — tenant reads its own; service_role manages (mirrors payg_reminder_log)
-- ---------------------------------------------------------------------------
ALTER TABLE public.auto_extension_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auto_ext_reminders_select ON public.auto_extension_reminders;
CREATE POLICY auto_ext_reminders_select ON public.auto_extension_reminders
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS auto_ext_reminders_service ON public.auto_extension_reminders;
CREATE POLICY auto_ext_reminders_service ON public.auto_extension_reminders
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.auto_extension_reminders IS
  'Per-message log of auto-extension pay-link emails / nudges / manual reminders. Drives the control panel reminder history, calendar, and paid-through-link tracking.';
