-- admin_nav_preferences: each super admin's own arrangement of the super-admin
-- dashboard's sidebar (Customise sidebar).
--
-- Its own table, not user_nav_preferences: that table is unique on
-- app_user_id and holds the PORTAL sidebar a super admin uses while viewing a
-- tenant (keyed with that tenant's id). Writing the admin sidebar there would
-- overwrite their portal one.
--
-- RLS ON, one policy: a user reads and writes only the row whose app_user_id
-- is their own. Additive (V2_PLAN §4): a new table nothing else touches.

create table if not exists public.admin_nav_preferences (
  app_user_id uuid primary key references public.app_users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_nav_preferences enable row level security;

drop policy if exists "Users manage their own admin nav preferences" on public.admin_nav_preferences;
create policy "Users manage their own admin nav preferences"
  on public.admin_nav_preferences
  for all
  to authenticated
  using (app_user_id in (select id from public.app_users where auth_user_id = auth.uid()))
  with check (app_user_id in (select id from public.app_users where auth_user_id = auth.uid()));

grant select, insert, update, delete on public.admin_nav_preferences to authenticated;
