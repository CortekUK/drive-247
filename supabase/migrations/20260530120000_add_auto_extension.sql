-- Auto-Extension Rentals: additive, opt-in billing mode.
--
-- A regular rental that auto-renews each period (weekly/monthly) and charges UPFRONT,
-- built on top of the existing rental_extensions feature. PAYG / installments / normal
-- rentals are untouched. See docs/AUTO_EXTENSION.md for the full design.
--
-- This migration ONLY adds columns + an index + a scan index. No data is modified.

-- ---------------------------------------------------------------------------
-- 1. Tenant-level defaults (master toggle + policy knobs)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS auto_extend_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_extend_default_charge_mode text NOT NULL DEFAULT 'pay_link',
  ADD COLUMN IF NOT EXISTS auto_extend_default_lead_hours integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_extend_grace_hours integer NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS auto_extend_max_retries integer NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_auto_extend_charge_mode_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_auto_extend_charge_mode_check
      CHECK (auto_extend_default_charge_mode IN ('auto_charge', 'pay_link'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_auto_extend_lead_hours_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_auto_extend_lead_hours_check
      CHECK (auto_extend_default_lead_hours >= 0 AND auto_extend_default_lead_hours <= 168);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_auto_extend_grace_hours_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_auto_extend_grace_hours_check
      CHECK (auto_extend_grace_hours >= 0 AND auto_extend_grace_hours <= 720);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_auto_extend_max_retries_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_auto_extend_max_retries_check
      CHECK (auto_extend_max_retries >= 0 AND auto_extend_max_retries <= 20);
  END IF;
END $$;

COMMENT ON COLUMN public.tenants.auto_extend_enabled IS
  'Master toggle: allow rentals on this tenant to use auto-extension (prepaid, rolling).';
COMMENT ON COLUMN public.tenants.auto_extend_default_charge_mode IS
  'Default charge mode for new auto-extend rentals: auto_charge (saved card off-session) or pay_link (emailed checkout).';
COMMENT ON COLUMN public.tenants.auto_extend_default_lead_hours IS
  'Hours before the current paid period ends to fire the next upfront charge (0 = exactly at the boundary).';
COMMENT ON COLUMN public.tenants.auto_extend_grace_hours IS
  'After a failed auto-charge, keep retrying within this window before pausing the rental.';
COMMENT ON COLUMN public.tenants.auto_extend_max_retries IS
  'Max consecutive failed auto-charge attempts before the rental is paused.';

-- ---------------------------------------------------------------------------
-- 2. Per-rental auto-extension state
-- ---------------------------------------------------------------------------
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS auto_extend_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_extend_charge_mode text NOT NULL DEFAULT 'pay_link',
  ADD COLUMN IF NOT EXISTS auto_extend_period_unit text NOT NULL DEFAULT 'Weekly',
  ADD COLUMN IF NOT EXISTS auto_extend_next_charge_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_extend_lead_hours integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_extend_charge_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_extend_max_periods integer,
  ADD COLUMN IF NOT EXISTS auto_extend_last_charge_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_extend_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_extend_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_extend_failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_extend_pending_extension_id uuid,
  ADD COLUMN IF NOT EXISTS auto_extend_status text NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rentals_auto_extend_charge_mode_check') THEN
    ALTER TABLE public.rentals
      ADD CONSTRAINT rentals_auto_extend_charge_mode_check
      CHECK (auto_extend_charge_mode IN ('auto_charge', 'pay_link'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rentals_auto_extend_period_unit_check') THEN
    ALTER TABLE public.rentals
      ADD CONSTRAINT rentals_auto_extend_period_unit_check
      CHECK (auto_extend_period_unit IN ('Daily', 'Weekly', 'Monthly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rentals_auto_extend_status_check') THEN
    ALTER TABLE public.rentals
      ADD CONSTRAINT rentals_auto_extend_status_check
      CHECK (auto_extend_status IN ('active', 'awaiting_payment', 'paused', 'ended'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rentals_auto_extend_max_periods_check') THEN
    ALTER TABLE public.rentals
      ADD CONSTRAINT rentals_auto_extend_max_periods_check
      CHECK (auto_extend_max_periods IS NULL OR (auto_extend_max_periods >= 1 AND auto_extend_max_periods <= 520));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rentals_auto_extend_pending_ext_fk') THEN
    ALTER TABLE public.rentals
      ADD CONSTRAINT rentals_auto_extend_pending_ext_fk
      FOREIGN KEY (auto_extend_pending_extension_id)
      REFERENCES public.rental_extensions(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.rentals.auto_extend_enabled IS
  'When true, this rental auto-renews each period and is charged UPFRONT by the auto-extend cron.';
COMMENT ON COLUMN public.rentals.auto_extend_charge_mode IS
  'auto_charge = charge the saved card off-session; pay_link = email a checkout link each period.';
COMMENT ON COLUMN public.rentals.auto_extend_period_unit IS
  'Renewal cadence: Daily (+1d), Weekly (+7d), Monthly (+1 month). Per-period price is rentals.monthly_amount.';
COMMENT ON COLUMN public.rentals.auto_extend_next_charge_at IS
  'When the next upfront charge fires (anchored to the current paid period end minus lead). Cron scans this.';
COMMENT ON COLUMN public.rentals.auto_extend_pending_extension_id IS
  'For pay_link mode: the unpaid extension awaiting customer payment. Blocks creating another until settled.';
COMMENT ON COLUMN public.rentals.auto_extend_status IS
  'active | awaiting_payment (pay-link sent) | paused (charges failing) | ended (returned/stopped).';

-- ---------------------------------------------------------------------------
-- 3. Cron scan index — mirrors the PAYG accrual scan index pattern
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rentals_auto_extend_next_charge
  ON public.rentals (auto_extend_next_charge_at)
  WHERE auto_extend_enabled = true AND auto_extend_paused = false;
