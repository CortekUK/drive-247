-- ============================================================
-- Simplified Expense Tracker: type categories as Business vs Vehicle.
-- The Add Expense dialog filters the category dropdown by the chosen type.
-- (pnl_bucket is retained so the existing P&L sync trigger keeps working.)
-- ============================================================

ALTER TABLE public.expense_categories
  ADD COLUMN IF NOT EXISTS category_type text NOT NULL DEFAULT 'business';

ALTER TABLE public.expense_categories
  DROP CONSTRAINT IF EXISTS expense_categories_category_type_check;
ALTER TABLE public.expense_categories
  ADD CONSTRAINT expense_categories_category_type_check
  CHECK (category_type IN ('business', 'vehicle'));

-- The originally-seeded vehicle defaults become 'vehicle'; everything else stays 'business'.
UPDATE public.expense_categories
SET category_type = 'vehicle'
WHERE name IN ('Repair', 'Service', 'Tyres', 'Valet', 'Accessory', 'Other');

CREATE INDEX IF NOT EXISTS idx_expense_categories_tenant_type
  ON public.expense_categories (tenant_id, category_type);
