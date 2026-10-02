-- trax_insights_reports — every Trax business review an operator generated.
--
-- Two jobs:
--   1. The weekly limit. `trax-insights-summary` refuses a new review while
--      the tenant's latest one is under 7 days old (super admins excepted, for
--      support). The check lives in the edge function, which is the only
--      writer — the browser can neither insert nor skip it.
--   2. One shared review per business. The portal reads the latest row, so
--      every member of the team sees the same review rather than each browser
--      keeping its own copy.
--
-- Additive only (V2_PLAN §4): a new table, nothing in v1 reads it. RLS on:
-- members of the tenant (and super admins) may read; nobody writes from the
-- client — inserts come from the edge function's service role.

CREATE TABLE IF NOT EXISTS public.trax_insights_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  months       smallint NOT NULL CHECK (months IN (3, 6, 12)),
  period_from  date NOT NULL,
  period_to    date NOT NULL,
  summary      jsonb NOT NULL,
  facts_key    text,
  model        text NOT NULL,
  created_by   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trax_insights_reports_tenant_latest_idx
  ON public.trax_insights_reports (tenant_id, created_at DESC);

ALTER TABLE public.trax_insights_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trax_insights_reports_read ON public.trax_insights_reports;
CREATE POLICY trax_insights_reports_read ON public.trax_insights_reports
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

GRANT SELECT ON public.trax_insights_reports TO authenticated;
