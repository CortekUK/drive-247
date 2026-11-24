-- Team Board: one place for the platform team's notes, documents and images.
--                                                                 (2026-11-24)
--
-- Before this, suggestions and PDFs were passed around in chat with nowhere to
-- track them. A post is some text, optionally with one document or one image
-- attached (the text then says what the file is about). Each post has a state
-- (not started, in progress, done), who put it up, who it is for, and a date.
-- Anyone on the team can edit or delete a post, and star the ones they want
-- to find again.
--
-- Platform staff only: every policy is `is_super_admin()`, the same rule as
-- admin_todos. Tenants and customers never see this table or its files.
--
-- Shown in Super Admin under Internal > Team Board (apps/admin).

create type public.team_board_kind as enum ('note', 'document', 'image');
create type public.team_board_status as enum ('not_started', 'in_progress', 'done');

create table public.team_board_items (
  id uuid primary key default gen_random_uuid(),
  kind public.team_board_kind not null default 'note',
  -- What they wrote. With a file attached, what the file is about.
  body text not null,
  -- The one attached file, in the private `team-board` bucket.
  attachment_path text,
  attachment_name text,
  attachment_type text,
  attachment_size bigint,
  status public.team_board_status not null default 'not_started',
  -- Who put this up.
  created_by uuid not null references public.app_users (id),
  -- Who it is for. NULL means the whole team.
  for_user_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_board_items_body_not_blank check (char_length(btrim(body)) >= 1),
  constraint team_board_items_body_length check (char_length(body) <= 5000),
  -- A note has no file; a document or image always has one.
  constraint team_board_items_attachment_matches_kind check ((kind = 'note') = (attachment_path is null))
);

comment on table public.team_board_items is
  'Platform team board (Super Admin > Internal > Team Board). Staff only.';

create index team_board_items_created_at_idx on public.team_board_items (created_at desc);
create index team_board_items_status_idx on public.team_board_items (status);
create index team_board_items_for_user_idx on public.team_board_items (for_user_id);

create trigger team_board_items_set_updated_at
  before update on public.team_board_items
  for each row execute function public.set_updated_at();

alter table public.team_board_items enable row level security;

create policy "team board: staff read" on public.team_board_items
  for select to authenticated using (public.is_super_admin());

-- A post is always put up in your own name.
create policy "team board: staff add" on public.team_board_items
  for insert to authenticated
  with check (
    public.is_super_admin()
    and created_by = (select u.id from public.app_users u where u.auth_user_id = auth.uid())
  );

create policy "team board: staff change" on public.team_board_items
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

create policy "team board: staff delete" on public.team_board_items
  for delete to authenticated using (public.is_super_admin());

-- Stated outright, so production and staging end up with the same permissions
-- whatever each project grants a new table by default.
revoke all on table public.team_board_items from public, anon, authenticated;
grant select, insert, update, delete on table public.team_board_items to authenticated;
grant all on table public.team_board_items to service_role;

-- Favourites ----------------------------------------------------------------
-- Each person stars posts for themselves: my favourites are not yours.

create table public.team_board_favorites (
  item_id uuid not null references public.team_board_items (id) on delete cascade,
  user_id uuid not null references public.app_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

comment on table public.team_board_favorites is
  'Which Team Board posts each staff member has starred. One row per person per post.';

create index team_board_favorites_user_idx on public.team_board_favorites (user_id);

alter table public.team_board_favorites enable row level security;

-- You read, add and remove only your own stars.
create policy "team board favourites: own read" on public.team_board_favorites
  for select to authenticated
  using (public.is_super_admin() and user_id = (select u.id from public.app_users u where u.auth_user_id = auth.uid()));

create policy "team board favourites: own add" on public.team_board_favorites
  for insert to authenticated
  with check (public.is_super_admin() and user_id = (select u.id from public.app_users u where u.auth_user_id = auth.uid()));

create policy "team board favourites: own remove" on public.team_board_favorites
  for delete to authenticated
  using (public.is_super_admin() and user_id = (select u.id from public.app_users u where u.auth_user_id = auth.uid()));

revoke all on table public.team_board_favorites from public, anon, authenticated;
grant select, insert, delete on table public.team_board_favorites to authenticated;
grant all on table public.team_board_favorites to service_role;

-- The files -----------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-board',
  'team-board',
  false,
  26214400, -- 25 MB
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif'
  ]::text[]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "team board files: staff read" on storage.objects
  for select to authenticated using (bucket_id = 'team-board' and public.is_super_admin());

create policy "team board files: staff add" on storage.objects
  for insert to authenticated with check (bucket_id = 'team-board' and public.is_super_admin());

create policy "team board files: staff delete" on storage.objects
  for delete to authenticated using (bucket_id = 'team-board' and public.is_super_admin());
