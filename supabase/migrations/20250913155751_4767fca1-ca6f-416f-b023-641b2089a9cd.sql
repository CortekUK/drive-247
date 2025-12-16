-- 1) ledger_entries: ensure payment_id column + unique partial index
ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS payment_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_entries_payment_id
  ON public.ledger_entries (payment_id)
  WHERE payment_id IS NOT NULL;

-- 2) pnl_entries: ensure reference column + unique partial index on reference
ALTER TABLE public.pnl_entries
  ADD COLUMN IF NOT EXISTS reference text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pnl_reference
  ON public.pnl_entries (reference)
  WHERE reference IS NOT NULL;

-- 3) rental monthly charges: make sure the unique constraint used by code exists
CREATE UNIQUE INDEX IF NOT EXISTS ux_rental_charge_unique
  ON public.ledger_entries (rental_id, due_date, type, category)
  WHERE rental_id IS NOT NULL AND type = 'Charge' AND category = 'Rental';