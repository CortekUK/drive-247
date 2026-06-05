-- ============================================================
-- Simplified Expense Tracker: capture a full timestamp (date + time of day).
-- The new UI reads/writes expense_at; expense_date is still maintained on insert
-- (date portion) so the existing handle_vehicle_expense_pnl() trigger, which keys
-- pnl_entries.entry_date off expense_date, keeps working unchanged.
-- ============================================================

ALTER TABLE public.vehicle_expenses
  ADD COLUMN IF NOT EXISTS expense_at timestamptz;

-- Backfill from the existing date (midnight UTC) for historical rows.
UPDATE public.vehicle_expenses
SET expense_at = expense_date::timestamptz
WHERE expense_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_expenses_tenant_expense_at
  ON public.vehicle_expenses (tenant_id, expense_at DESC);
