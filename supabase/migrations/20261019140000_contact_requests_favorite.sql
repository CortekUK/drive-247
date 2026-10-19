-- Contact requests admin rebuild (Ghulam, Oct 19 2026): star a lead, and know
-- when a row was last edited by hand. Manual and imported rows use source
-- 'manual' / 'import' beside the existing 'website' / 'strategy-call'.
alter table public.contact_requests
  add column if not exists is_favorite boolean not null default false,
  add column if not exists updated_at timestamptz;

create index if not exists contact_requests_created_at_idx on public.contact_requests (created_at desc);
