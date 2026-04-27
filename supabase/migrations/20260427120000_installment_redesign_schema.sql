-- Installment redesign schema:
--   1. Simplified tenant.installment_settings model (week|month + payments_per_unit)
--   2. installment_plans gets unit, payments_per_unit, collection_mode, last_reminder_sent_at
--   3. scheduled_installments gets invoice_status (open|paid|superseded), settling_payment_id, superseded_by
--   4. installment_notifications enriched for timeline / reminder log surfaces
--   5. Backfills existing rows so the new model is the source of truth

-- ─────────────────────────────────────────────────────────────────────
-- 1. Tenant settings: replace ad-hoc installment_config with a clean shape
-- ─────────────────────────────────────────────────────────────────────

-- Default for new tenants
ALTER TABLE public.tenants
  ALTER COLUMN installment_config SET DEFAULT
    jsonb_build_object(
      'weekly_enabled', false,
      'weekly_payments_per_unit', 1,
      'monthly_enabled', false,
      'monthly_payments_per_unit', 1
    );

-- Backfill existing tenants — keep enabled toggles defaulted off; operators flip on per-tenant.
UPDATE public.tenants
SET installment_config = jsonb_build_object(
      'weekly_enabled', COALESCE((installment_config->>'weekly_enabled')::boolean, false),
      'weekly_payments_per_unit',
        CASE WHEN (installment_config->>'allow_semiweekly')::boolean = true THEN 2 ELSE 1 END,
      'monthly_enabled', COALESCE((installment_config->>'monthly_enabled')::boolean, false),
      'monthly_payments_per_unit', 1
    )
WHERE installment_config IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2. installment_plans: cadence + collection mode + reminder anchor
-- ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE installment_unit AS ENUM ('week','month');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE installment_collection_mode AS ENUM ('auto','manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.installment_plans
  ADD COLUMN IF NOT EXISTS unit installment_unit,
  ADD COLUMN IF NOT EXISTS payments_per_unit integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS collection_mode installment_collection_mode DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_sca_failures integer DEFAULT 0;

-- Backfill from legacy plan_type
UPDATE public.installment_plans
SET unit = CASE
            WHEN plan_type = 'monthly' THEN 'month'::installment_unit
            ELSE 'week'::installment_unit
          END,
    payments_per_unit = CASE
            WHEN plan_type = 'semiweekly' THEN 2
            ELSE 1
          END
WHERE unit IS NULL;

-- collection_mode follows the legacy "do we have a saved card" shape
UPDATE public.installment_plans
SET collection_mode = CASE
            WHEN stripe_payment_method_id IS NOT NULL THEN 'auto'::installment_collection_mode
            ELSE 'manual'::installment_collection_mode
          END
WHERE collection_mode IS NULL;

ALTER TABLE public.installment_plans
  ALTER COLUMN unit SET NOT NULL,
  ALTER COLUMN payments_per_unit SET NOT NULL,
  ALTER COLUMN collection_mode SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 3. scheduled_installments: open|paid|superseded supersession model
-- ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE installment_invoice_status AS ENUM ('open','paid','superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.scheduled_installments
  ADD COLUMN IF NOT EXISTS invoice_status installment_invoice_status DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS settling_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_by_installment_id uuid REFERENCES public.scheduled_installments(id) ON DELETE SET NULL;

-- Backfill from legacy text status
UPDATE public.scheduled_installments
SET invoice_status = CASE
            WHEN status = 'paid' THEN 'paid'::installment_invoice_status
            ELSE 'open'::installment_invoice_status
          END
WHERE invoice_status IS NULL;

ALTER TABLE public.scheduled_installments
  ALTER COLUMN invoice_status SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_installments_plan_invoice_status
  ON public.scheduled_installments(installment_plan_id, invoice_status);

CREATE INDEX IF NOT EXISTS idx_scheduled_installments_open_due
  ON public.scheduled_installments(due_date)
  WHERE invoice_status = 'open';

-- ─────────────────────────────────────────────────────────────────────
-- 4. installment_notifications: enrich for timeline + reminder log views
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.installment_notifications
  ADD COLUMN IF NOT EXISTS installment_plan_id uuid REFERENCES public.installment_plans(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS amount numeric,
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_installment_notifications_plan_created
  ON public.installment_notifications(installment_plan_id, created_at DESC);
