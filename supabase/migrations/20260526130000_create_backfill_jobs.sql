-- Finance Sync — Sprint 4: historical backfill jobs.
-- Spec §12. When a tenant connects a provider, they may want to sync the
-- last N months of historical financial events. Naively the cron could just
-- pick up old rows — but they don't have sync_state rows for the new provider
-- yet (those only get created on enqueue going forward).
--
-- The Backfill wizard creates a `backfill_jobs` row → returns immediately →
-- the `process-backfill-jobs` cron (every 1 min) reads pending jobs, finds
-- financial_events in the date range for the tenant that don't yet have a
-- sync_state row for the target provider, and inserts the missing rows.
-- The normal `process-accounting-sync` cron then picks them up.

CREATE TYPE public.backfill_job_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

CREATE TABLE IF NOT EXISTS public.backfill_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider public.accounting_provider NOT NULL,

  /** Date range — inclusive. NULL date_from = since-the-beginning. */
  date_from DATE,
  date_to DATE NOT NULL,

  status public.backfill_job_status NOT NULL DEFAULT 'pending',

  /** Progress telemetry. The wizard polls these every 5s while the job runs. */
  total_events INTEGER NOT NULL DEFAULT 0,
  processed_events INTEGER NOT NULL DEFAULT 0,
  failed_events INTEGER NOT NULL DEFAULT 0,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX backfill_jobs_tenant_idx ON public.backfill_jobs (tenant_id, created_at DESC);

-- The worker picks up pending jobs in FIFO order — index supports the
-- "WHERE status='pending' ORDER BY created_at" pattern.
CREATE INDEX backfill_jobs_pending_idx
  ON public.backfill_jobs (status, created_at)
  WHERE status IN ('pending', 'running');

CREATE TRIGGER set_backfill_jobs_updated_at
  BEFORE UPDATE ON public.backfill_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.backfill_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_staff_read_backfill_jobs"
  ON public.backfill_jobs
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY "service_role_full_access_backfill_jobs"
  ON public.backfill_jobs
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.backfill_jobs IS
  'One row per historical-sync request. Wizard creates; process-backfill-jobs cron processes; UI polls progress. Spec §12.';
