-- Persist in-progress Bonzah onboarding drafts to the DB so a tenant can
-- pause halfway and resume later from ANY browser/device (previously the
-- draft lived only in browser localStorage and was lost on device switch /
-- cache clear). One draft per tenant; the form upserts on every change.

create table if not exists public.bonzah_onboarding_drafts (
  tenant_id  uuid primary key references public.tenants(id) on delete cascade,
  draft      jsonb not null default '{}'::jsonb,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bonzah_onboarding_drafts is
  'In-progress (unsubmitted) Bonzah onboarding form state, one row per tenant. Cleared on final submission.';

alter table public.bonzah_onboarding_drafts enable row level security;

-- Tenant members manage their own draft; super admins can see all.
create policy "Tenant reads own bonzah draft"
  on public.bonzah_onboarding_drafts for select
  using (tenant_id = get_user_tenant_id() or is_super_admin());

create policy "Tenant inserts own bonzah draft"
  on public.bonzah_onboarding_drafts for insert
  with check (tenant_id = get_user_tenant_id() or is_super_admin());

create policy "Tenant updates own bonzah draft"
  on public.bonzah_onboarding_drafts for update
  using (tenant_id = get_user_tenant_id() or is_super_admin())
  with check (tenant_id = get_user_tenant_id() or is_super_admin());

create policy "Tenant deletes own bonzah draft"
  on public.bonzah_onboarding_drafts for delete
  using (tenant_id = get_user_tenant_id() or is_super_admin());

create trigger set_bonzah_onboarding_drafts_updated_at
  before update on public.bonzah_onboarding_drafts
  for each row execute function public.set_updated_at();
