-- ============================================================
-- Expense Tracker: extend vehicle_expenses into a full expense model,
-- add per-tenant custom categories, receipts bucket, and keep P&L in sync.
-- ============================================================

-- 1. Extend vehicle_expenses ------------------------------------------------
-- Make vehicle link optional: NULL vehicle_id = business-wide / overhead expense.
ALTER TABLE public.vehicle_expenses ALTER COLUMN vehicle_id DROP NOT NULL;

-- Move category from a fixed enum to free text so tenants can add custom categories.
ALTER TABLE public.vehicle_expenses ALTER COLUMN category DROP DEFAULT;
ALTER TABLE public.vehicle_expenses ALTER COLUMN category TYPE text USING category::text;
ALTER TABLE public.vehicle_expenses ALTER COLUMN category SET DEFAULT 'Other';

-- New bookkeeping fields.
ALTER TABLE public.vehicle_expenses
  ADD COLUMN IF NOT EXISTS vendor text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS receipt_url text,
  ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence_interval text;

ALTER TABLE public.vehicle_expenses
  DROP CONSTRAINT IF EXISTS vehicle_expenses_recurrence_interval_check;
ALTER TABLE public.vehicle_expenses
  ADD CONSTRAINT vehicle_expenses_recurrence_interval_check
  CHECK (recurrence_interval IS NULL OR recurrence_interval IN ('monthly', 'yearly'));

CREATE INDEX IF NOT EXISTS idx_vehicle_expenses_tenant_date
  ON public.vehicle_expenses (tenant_id, expense_date DESC);

COMMENT ON TABLE public.vehicle_expenses IS
  'Business expenses. vehicle_id NULL = company-wide/overhead expense; set = vehicle cost. Feeds pnl_entries via handle_vehicle_expense_pnl().';

-- 2. Per-tenant expense categories -----------------------------------------
CREATE TABLE IF NOT EXISTS public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  pnl_bucket text NOT NULL DEFAULT 'Expenses',
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, name),
  CONSTRAINT expense_categories_pnl_bucket_check CHECK (pnl_bucket IN ('Service', 'Expenses'))
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_tenant
  ON public.expense_categories (tenant_id);

DROP TRIGGER IF EXISTS set_expense_categories_updated_at ON public.expense_categories;
CREATE TRIGGER set_expense_categories_updated_at
  BEFORE UPDATE ON public.expense_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: tenant-scoped reads, head-admin/admin manage, service_role full access.
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant read expense_categories" ON public.expense_categories;
CREATE POLICY "tenant read expense_categories"
  ON public.expense_categories FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "tenant manage expense_categories" ON public.expense_categories;
CREATE POLICY "tenant manage expense_categories"
  ON public.expense_categories FOR ALL
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "service_role manage expense_categories" ON public.expense_categories;
CREATE POLICY "service_role manage expense_categories"
  ON public.expense_categories FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- 3. Seed default + common categories for every tenant ----------------------
INSERT INTO public.expense_categories (tenant_id, name, pnl_bucket, is_default, sort_order)
SELECT t.id, d.name, d.bucket, d.is_def, d.ord
FROM public.tenants t
CROSS JOIN (VALUES
  -- Original vehicle categories (protected defaults)
  ('Repair',    'Expenses', true,  10),
  ('Service',   'Service',  true,  20),
  ('Tyres',     'Expenses', true,  30),
  ('Valet',     'Expenses', true,  40),
  ('Accessory', 'Expenses', true,  50),
  ('Other',     'Expenses', true,  60),
  -- Common business / overhead categories (editable)
  ('Insurance', 'Expenses', false, 70),
  ('Fuel',      'Expenses', false, 80),
  ('Cleaning',  'Expenses', false, 90),
  ('Rent',      'Expenses', false, 100),
  ('Utilities', 'Expenses', false, 110),
  ('Marketing', 'Expenses', false, 120),
  ('Software',  'Expenses', false, 130),
  ('Salaries',  'Expenses', false, 140),
  ('Parking',   'Expenses', false, 150),
  ('Tolls',     'Expenses', false, 160)
) AS d(name, bucket, is_def, ord)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 4. Update the P&L sync trigger -------------------------------------------
--    - resolve P&L bucket from expense_categories (supports custom categories)
--    - always stamp tenant_id on pnl_entries (so overhead rolls into totals)
--    - skip vehicle_events when the expense is not tied to a vehicle
CREATE OR REPLACE FUNCTION public.handle_vehicle_expense_pnl()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    pnl_category TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM public.pnl_entries WHERE reference = 'vexp:' || OLD.id::text;
        IF OLD.vehicle_id IS NOT NULL THEN
            INSERT INTO public.vehicle_events (
                vehicle_id, event_type, summary, reference_id, reference_table
            ) VALUES (
                OLD.vehicle_id, 'expense_removed',
                'Removed ' || OLD.category || ' expense',
                OLD.id, 'vehicle_expenses'
            );
        END IF;
        RETURN OLD;
    END IF;

    -- Resolve P&L bucket from the tenant's category config (handles custom categories).
    SELECT ec.pnl_bucket INTO pnl_category
    FROM public.expense_categories ec
    WHERE ec.tenant_id = NEW.tenant_id AND ec.name = NEW.category
    LIMIT 1;

    IF pnl_category IS NULL THEN
        -- Fallback to legacy hardcoded mapping if no category row exists.
        IF NEW.category = 'Service' THEN
            pnl_category := 'Service';
        ELSE
            pnl_category := 'Expenses';
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.pnl_entries (
            vehicle_id, tenant_id, entry_date, side, category, amount, reference
        ) VALUES (
            NEW.vehicle_id, NEW.tenant_id, NEW.expense_date, 'Cost',
            pnl_category, NEW.amount, 'vexp:' || NEW.id::text
        );
        IF NEW.vehicle_id IS NOT NULL THEN
            INSERT INTO public.vehicle_events (
                vehicle_id, event_type, summary, reference_id, reference_table
            ) VALUES (
                NEW.vehicle_id, 'expense_added',
                'Added ' || NEW.category || ' expense',
                NEW.id, 'vehicle_expenses'
            );
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE public.pnl_entries
        SET amount = NEW.amount,
            entry_date = NEW.expense_date,
            category = pnl_category,
            tenant_id = NEW.tenant_id,
            vehicle_id = NEW.vehicle_id
        WHERE reference = 'vexp:' || NEW.id::text;
        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$function$;

-- 5. Backfill pnl_entries.tenant_id from the linked vehicle (fixes latent gap
--    where vehicle-expense P&L rows were excluded from tenant-scoped summaries).
UPDATE public.pnl_entries pe
SET tenant_id = v.tenant_id
FROM public.vehicles v
WHERE pe.vehicle_id = v.id
  AND pe.tenant_id IS NULL;

-- 6. Receipts storage bucket (private) + policies ---------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  false,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];

DROP POLICY IF EXISTS "Authenticated upload expense-receipts" ON storage.objects;
CREATE POLICY "Authenticated upload expense-receipts"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'expense-receipts');

DROP POLICY IF EXISTS "Authenticated read expense-receipts" ON storage.objects;
CREATE POLICY "Authenticated read expense-receipts"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'expense-receipts');

DROP POLICY IF EXISTS "Authenticated delete expense-receipts" ON storage.objects;
CREATE POLICY "Authenticated delete expense-receipts"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'expense-receipts');

DROP POLICY IF EXISTS "service_role manage expense-receipts" ON storage.objects;
CREATE POLICY "service_role manage expense-receipts"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'expense-receipts')
  WITH CHECK (bucket_id = 'expense-receipts');
