-- ============================================================
-- Simplified Expense Tracker: cached AI summaries (one per tenant per tab/scope).
-- The generate-expense-summary edge function (service_role) upserts here; the
-- portal reads the cached summary so it shows instantly on revisit.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.expense_ai_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('overall', 'business', 'vehicle')),
  summary text NOT NULL DEFAULT '',
  source_count integer NOT NULL DEFAULT 0,
  source_total numeric(14,2) NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_expense_ai_summaries_tenant
  ON public.expense_ai_summaries (tenant_id);

DROP TRIGGER IF EXISTS set_expense_ai_summaries_updated_at ON public.expense_ai_summaries;
CREATE TRIGGER set_expense_ai_summaries_updated_at
  BEFORE UPDATE ON public.expense_ai_summaries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.expense_ai_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant read expense_ai_summaries" ON public.expense_ai_summaries;
CREATE POLICY "tenant read expense_ai_summaries"
  ON public.expense_ai_summaries FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "service_role manage expense_ai_summaries" ON public.expense_ai_summaries;
CREATE POLICY "service_role manage expense_ai_summaries"
  ON public.expense_ai_summaries FOR ALL
  TO service_role USING (true) WITH CHECK (true);
