-- Team Board: a post can carry several files.                      (2026-11-24)
--
-- Until now a post had one file, stored in columns on the post itself. The
-- files move to their own table, one row per file, and the post no longer has
-- a single "kind": what a post is follows from the files on it (none = a note).

create table public.team_board_attachments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.team_board_items (id) on delete cascade,
  kind public.team_board_kind not null,
  -- Where the file sits in the private `team-board` bucket.
  path text not null,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  -- The order the files were added in.
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint team_board_attachments_path_key unique (path),
  constraint team_board_attachments_kind_is_a_file check (kind <> 'note'),
  constraint team_board_attachments_size_not_negative check (size_bytes >= 0)
);

comment on table public.team_board_attachments is
  'The files on a Team Board post, one row per file. Staff only.';

create index team_board_attachments_item_idx on public.team_board_attachments (item_id, sort_order);

alter table public.team_board_attachments enable row level security;

create policy "team board attachments: staff read" on public.team_board_attachments
  for select to authenticated using (public.is_super_admin());

create policy "team board attachments: staff add" on public.team_board_attachments
  for insert to authenticated with check (public.is_super_admin());

create policy "team board attachments: staff remove" on public.team_board_attachments
  for delete to authenticated using (public.is_super_admin());

revoke all on table public.team_board_attachments from public, anon, authenticated;
grant select, insert, delete on table public.team_board_attachments to authenticated;
grant all on table public.team_board_attachments to service_role;

-- The one file each existing post has becomes its first row.
insert into public.team_board_attachments (item_id, kind, path, name, mime_type, size_bytes, created_at)
select id, kind, attachment_path, coalesce(attachment_name, 'file'), coalesce(attachment_type, 'application/octet-stream'),
       coalesce(attachment_size, 0), created_at
from public.team_board_items
where attachment_path is not null;

alter table public.team_board_items
  drop constraint team_board_items_attachment_matches_kind,
  drop column attachment_path,
  drop column attachment_name,
  drop column attachment_type,
  drop column attachment_size,
  drop column kind;
