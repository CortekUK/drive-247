-- TRAX report generation: a private bucket and a job table.
--
-- NOT APPLIED, and deliberately NOT in supabase/migrations/ — the deployed
-- migration history has diverged from the repository (124 local files unapplied,
-- 120 applied versions with no local file, see docs/trax/recovery-plan.md §4), so
-- nothing new goes into that directory until the drift is reconciled. Applying
-- this is its own reviewed decision, separate from the security containment.
--
-- APPLIED to production 2026-09-18. No flag is needed to use reports; an
-- environment WITHOUT this migration refuses with `report_failed`, so TRAX says
-- it could not produce a file rather than describing one that does not exist.
--
-- Scope: one table, one bucket, and policies. It adds no capability to any
-- existing table and changes no existing policy.

begin;

-- ── The job record ──────────────────────────────────────────────────────────
-- One row per report asked for, including the ones that fail, so a failure is
-- visible rather than silent.
create table if not exists public.trax_report_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Who asked. app_users.id, not auth.uid(), matching how TRAX identifies staff.
  requested_by uuid not null,
  -- What was measured, e.g. 'payments.collected' or 'customer_balances'.
  kind text not null,
  format text not null check (format in ('csv', 'xlsx', 'pdf')),
  state text not null check (state in ('queued', 'running', 'ready', 'failed')),
  rows integer,
  bytes integer,
  -- Object path inside the bucket. Always begins with the tenant id.
  path text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A stored path must belong to the account that asked for it.
  constraint trax_report_jobs_path_is_tenant_scoped
    check (path is null or path like (tenant_id::text || '/%'))
);

create index if not exists trax_report_jobs_tenant_created_idx
  on public.trax_report_jobs (tenant_id, created_at desc);

comment on table public.trax_report_jobs is
  'Reports TRAX has generated. One row per request, including failures. The file itself lives in the private trax-reports bucket under <tenant_id>/.';

-- ── Who may see a job ───────────────────────────────────────────────────────
alter table public.trax_report_jobs enable row level security;

-- Staff of the owning account, or a platform super admin, may read their jobs.
drop policy if exists trax_report_jobs_staff on public.trax_report_jobs;
create policy trax_report_jobs_staff on public.trax_report_jobs for select to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());

-- Only server code writes them: the edge function creates and updates the job.
drop policy if exists trax_report_jobs_service on public.trax_report_jobs;
create policy trax_report_jobs_service on public.trax_report_jobs for all to service_role
  using (true) with check (true);

-- The anonymous key has no business here at all.
revoke all on public.trax_report_jobs from anon;
grant select on public.trax_report_jobs to authenticated;
grant all on public.trax_report_jobs to service_role;

-- ── The private bucket ──────────────────────────────────────────────────────
-- `public => false`: objects are reachable only through a signed URL that the
-- edge function issues with the service credential.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trax-reports', 'trax-reports', false, 52428800,
  array['text/csv', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Server code writes and reads the objects. No policy is granted to `anon` or to
-- `authenticated`: a staff member downloads through the signed URL, never by
-- listing the bucket, so a stolen path is still useless once the link expires.
drop policy if exists trax_reports_service on storage.objects;
create policy trax_reports_service on storage.objects for all to service_role
  using (bucket_id = 'trax-reports') with check (bucket_id = 'trax-reports');

commit;

-- ── Verification after applying ─────────────────────────────────────────────
-- The bucket must be private:
--   select id, public, file_size_limit from storage.buckets where id = 'trax-reports';
-- The table must have RLS on and no anon grant:
--   select relrowsecurity from pg_class where relname = 'trax_report_jobs';
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'trax_report_jobs' order by grantee;
-- Then ask TRAX for a CSV. Expect a job row in state `ready`, an object under
-- <tenant_id>/, and a link that stops working after 15 minutes.
--
-- ── Rollback ────────────────────────────────────────────────────────────────
-- Set TRAX_REPORTS=disabled first, so nothing tries to write while it is going away:
--   drop policy if exists trax_reports_service on storage.objects;
--   delete from storage.objects where bucket_id = 'trax-reports';
--   delete from storage.buckets where id = 'trax-reports';
--   drop table if exists public.trax_report_jobs;
