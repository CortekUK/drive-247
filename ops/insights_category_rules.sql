-- insights_category_rules — an operator's own answer to "what counts where"
-- on the v2 Insights receipt.
--
-- The page classifies every `pnl_entries` row into one of four buckets by
-- default (apps/portal/src/app/(dashboard)/insights/_money-model.ts →
-- `defaultBucket`): money taken in, money that was never yours, money spent,
-- and car purchases. A row here OVERRIDES that default for one
-- (side, category) pair, for one tenant. No row = the default, so an empty
-- table changes nothing for anybody.
--
-- Additive only (V2_PLAN §4): a new table and a new enum. Nothing in v1 reads
-- it. Read only by the northwind-gated /insights route.
--
-- Isolation: every portal read and write carries `.eq('tenant_id', …)`
-- (V2_PLAN §5). RLS is ON here as a second lock; writes are limited to the
-- tenant's head_admin / admin, or a super admin.

DO $$ BEGIN
  CREATE TYPE public.insights_bucket AS ENUM (
    'operating_revenue',   -- money you took in, and yours
    'non_revenue',         -- taken in, never yours (tax, deposits)
    'operating_cost',      -- money you spent running the business
    'capital_cost',        -- buying / selling cars; outside profit
    'ignored'              -- left off the page entirely
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.insights_category_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  side        text NOT NULL CHECK (side IN ('Revenue', 'Cost')),
  category    text NOT NULL CHECK (length(category) BETWEEN 1 AND 200),
  bucket      public.insights_bucket NOT NULL,
  updated_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insights_category_rules_one_per_category UNIQUE (tenant_id, side, category),
  -- A Revenue row can only land in a revenue-side bucket, a Cost row in a
  -- cost-side one. Moving money across sides would make the receipt lie.
  CONSTRAINT insights_category_rules_bucket_matches_side CHECK (
    bucket = 'ignored'
    OR (side = 'Revenue' AND bucket IN ('operating_revenue', 'non_revenue'))
    OR (side = 'Cost'    AND bucket IN ('operating_cost', 'capital_cost'))
  )
);

CREATE INDEX IF NOT EXISTS insights_category_rules_tenant_idx
  ON public.insights_category_rules (tenant_id);

DROP TRIGGER IF EXISTS insights_category_rules_set_updated_at ON public.insights_category_rules;
CREATE TRIGGER insights_category_rules_set_updated_at
  BEFORE UPDATE ON public.insights_category_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.insights_category_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS insights_category_rules_read ON public.insights_category_rules;
CREATE POLICY insights_category_rules_read ON public.insights_category_rules
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS insights_category_rules_write ON public.insights_category_rules;
CREATE POLICY insights_category_rules_write ON public.insights_category_rules
  FOR ALL TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.auth_user_id = auth.uid()
        AND u.tenant_id = insights_category_rules.tenant_id
        AND u.role IN ('head_admin', 'admin')
        AND u.is_active
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.auth_user_id = auth.uid()
        AND u.tenant_id = insights_category_rules.tenant_id
        AND u.role IN ('head_admin', 'admin')
        AND u.is_active
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.insights_category_rules TO authenticated;
