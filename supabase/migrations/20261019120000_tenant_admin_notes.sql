-- tenant_admin_notes: the super-admin team's internal notes about a rental
-- company, shown on the company page in Super Admin (Rental Companies → a
-- company → Notes). Never visible to the company itself.
--
-- Every note records its author. Any super admin can read and add notes;
-- only the author can edit or delete their own. Pinned notes sort first.
--
-- Not to be confused with tenant_notes, which is the operator's own
-- reminders inside their portal.
--
-- Additive (V2_PLAN §4): a new table nothing else reads.

create table if not exists public.tenant_admin_notes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  author_id   uuid not null references public.app_users(id) on delete restrict,
  body        text not null check (length(btrim(body)) > 0),
  is_pinned   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tenant_admin_notes_tenant_idx
  on public.tenant_admin_notes (tenant_id, is_pinned desc, created_at desc);

drop trigger if exists tenant_admin_notes_updated_at on public.tenant_admin_notes;
create trigger tenant_admin_notes_updated_at
  before update on public.tenant_admin_notes
  for each row execute function public.set_updated_at();

alter table public.tenant_admin_notes enable row level security;

drop policy if exists tenant_admin_notes_select on public.tenant_admin_notes;
create policy tenant_admin_notes_select on public.tenant_admin_notes
  for select to authenticated
  using (public.is_super_admin());

drop policy if exists tenant_admin_notes_insert on public.tenant_admin_notes;
create policy tenant_admin_notes_insert on public.tenant_admin_notes
  for insert to authenticated
  with check (
    public.is_super_admin()
    and author_id = (select id from public.app_users where auth_user_id = auth.uid() limit 1)
  );

drop policy if exists tenant_admin_notes_update on public.tenant_admin_notes;
create policy tenant_admin_notes_update on public.tenant_admin_notes
  for update to authenticated
  using (
    public.is_super_admin()
    and author_id = (select id from public.app_users where auth_user_id = auth.uid() limit 1)
  )
  with check (
    author_id = (select id from public.app_users where auth_user_id = auth.uid() limit 1)
  );

drop policy if exists tenant_admin_notes_delete on public.tenant_admin_notes;
create policy tenant_admin_notes_delete on public.tenant_admin_notes
  for delete to authenticated
  using (
    public.is_super_admin()
    and author_id = (select id from public.app_users where auth_user_id = auth.uid() limit 1)
  );

revoke all on public.tenant_admin_notes from anon;
grant select, insert, update, delete on public.tenant_admin_notes to authenticated;
