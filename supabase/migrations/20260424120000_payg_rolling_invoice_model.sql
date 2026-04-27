-- PAYG Rolling Invoice Model
--
-- Each payg_accruals row is treated as a rolling invoice. Paying an invoice
-- settles that row + marks all prior "open" rows as "superseded" by it.
-- Reminders become daily (every 24h from rental activation) with a single
-- master toggle; cadence/grace/max knobs are retired from the UI but kept
-- as columns to avoid breaking any code that still reads them.

-- 1. Enrich payg_accruals with invoice lifecycle
ALTER TABLE public.payg_accruals
  ADD COLUMN IF NOT EXISTS invoice_status text NOT NULL DEFAULT 'open'
    CHECK (invoice_status IN ('open', 'paid', 'superseded')),
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS settling_payment_id uuid
    REFERENCES public.payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_by_accrual_id uuid
    REFERENCES public.payg_accruals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payg_accruals_rental_invoice_status
  ON public.payg_accruals(rental_id, invoice_status);

-- 2. Tag reminder log rows with the accrual/invoice that was open at send time
ALTER TABLE public.payg_reminder_log
  ADD COLUMN IF NOT EXISTS accrual_id uuid
    REFERENCES public.payg_accruals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payg_reminder_log_accrual
  ON public.payg_reminder_log(accrual_id);

-- 3. Single master toggle for automated reminders
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS payg_auto_reminders_enabled boolean NOT NULL DEFAULT true;
