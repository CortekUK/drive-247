-- insights_entry_adjustments — an operator's own corrections to single
-- entries on the v2 Insights receipt: "leave this one out", "this was really
-- $120, not $180".
--
-- It NEVER touches the ledger. `pnl_entries` and `payments` stay exactly as
-- they are for every other screen, invoice and export; this table only changes
-- what the northwind-gated /insights page adds up, and every adjusted line is
-- shown there with its original amount beside it and a way to restore it.
--
-- One row targets exactly one thing: a ledger entry (`pnl_entry_id`) or a
-- refund (`payment_id`). Deleting the target deletes the adjustment.
--
-- Additive only (V2_PLAN §4): a new table, nothing in v1 reads it. Isolation:
-- every portal read/write carries `.eq('tenant_id', …)` (§5); RLS is on as a
-- second lock, writes limited to head_admin / admin / super admin.

CREATE TABLE IF NOT EXISTS public.insights_entry_adjustments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pnl_entry_id  uuid REFERENCES public.pnl_entries(id) ON DELETE CASCADE,
  payment_id    uuid REFERENCES public.payments(id) ON DELETE CASCADE,
  excluded      boolean NOT NULL DEFAULT false,
  amount        numeric(12, 2) CHECK (amount >= 0),
  updated_by    uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insights_entry_adjustments_one_target CHECK (num_nonnulls(pnl_entry_id, payment_id) = 1),
  -- A row that neither excludes nor re-prices is no adjustment; delete it instead.
  CONSTRAINT insights_entry_adjustments_does_something CHECK (excluded OR amount IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS insights_entry_adjustments_entry_uniq
  ON public.insights_entry_adjustments (tenant_id, pnl_entry_id) WHERE pnl_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS insights_entry_adjustments_payment_uniq
  ON public.insights_entry_adjustments (tenant_id, payment_id) WHERE payment_id IS NOT NULL;
-- The FK targets need their own indexes so a ledger delete's cascade check is
-- an index probe, not a scan of this table.
CREATE INDEX IF NOT EXISTS insights_entry_adjustments_pnl_entry_idx
  ON public.insights_entry_adjustments (pnl_entry_id) WHERE pnl_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS insights_entry_adjustments_payment_idx
  ON public.insights_entry_adjustments (payment_id) WHERE payment_id IS NOT NULL;

DROP TRIGGER IF EXISTS insights_entry_adjustments_set_updated_at ON public.insights_entry_adjustments;
CREATE TRIGGER insights_entry_adjustments_set_updated_at
  BEFORE UPDATE ON public.insights_entry_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.insights_entry_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS insights_entry_adjustments_read ON public.insights_entry_adjustments;
CREATE POLICY insights_entry_adjustments_read ON public.insights_entry_adjustments
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS insights_entry_adjustments_write ON public.insights_entry_adjustments;
CREATE POLICY insights_entry_adjustments_write ON public.insights_entry_adjustments
  FOR ALL TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.auth_user_id = auth.uid()
        AND u.tenant_id = insights_entry_adjustments.tenant_id
        AND u.role IN ('head_admin', 'admin')
        AND u.is_active
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.auth_user_id = auth.uid()
        AND u.tenant_id = insights_entry_adjustments.tenant_id
        AND u.role IN ('head_admin', 'admin')
        AND u.is_active
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.insights_entry_adjustments TO authenticated;
