-- user_tour_progress: where each portal user is in the portal tours.
--
-- One row per user per tour key: the quick tour ("seen", the card they were
-- on) and each tab tour's topics (not started, in progress at step N, done).
-- Kept in the database so it follows the person to another device.
--
-- tour_key is the browser key without the user id on the end, for example
-- 'd247.tour.first-rental.v4' or 'd247.tour.tab.vehicles.v2'.
-- value is the stored text (JSON for progress); NULL means cleared.
--
-- RLS ON, one policy: a user reads and writes only their own rows, inside
-- their own tenant. Additive: a new table nothing else touches.

create table if not exists public.user_tour_progress (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tour_key text not null,
  value text,
  updated_at timestamptz not null default now(),
  primary key (app_user_id, tour_key)
);

create index if not exists user_tour_progress_tenant_idx on public.user_tour_progress (tenant_id);

alter table public.user_tour_progress enable row level security;

drop policy if exists "Users manage their own tour progress" on public.user_tour_progress;
create policy "Users manage their own tour progress"
  on public.user_tour_progress
  for all
  to authenticated
  using (
    app_user_id in (select id from public.app_users where auth_user_id = auth.uid())
    and tenant_id in (select tenant_id from public.app_users where auth_user_id = auth.uid())
  )
  with check (
    app_user_id in (select id from public.app_users where auth_user_id = auth.uid())
    and tenant_id in (select tenant_id from public.app_users where auth_user_id = auth.uid())
  );

grant select, insert, update, delete on public.user_tour_progress to authenticated;
