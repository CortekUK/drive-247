-- Lead sources (Ghulam, Oct 19 2026): contact requests arrive from the website
-- (strategy-call form), Meta Lead Ads and Google Ads lead forms.
--
--   lead_connections          one row per connected Facebook Page / Google Ads
--                             webhook; super admins read it.
--   lead_connection_secrets   the Page access token (Meta). Service role only.
--   lead_oauth_handoffs       a Facebook user token held for the few minutes
--                             between "Continue with Facebook" and picking
--                             Pages. Service role only.
--
-- Writes all go through the lead-sources / lead-webhook-* edge functions.

create table if not exists public.lead_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('meta', 'google')),
  label text not null,
  -- Meta: the Page id. Google: null (one webhook can serve every lead form).
  external_id text,
  -- Google: the key pasted into the lead form's webhook settings. Shown to
  -- super admins so they can paste it; it only lets a caller ADD leads.
  webhook_key text,
  status text not null default 'active' check (status in ('active', 'error')),
  last_error text,
  last_lead_at timestamptz,
  lead_count integer not null default 0,
  connected_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists lead_connections_provider_external
  on public.lead_connections (provider, external_id) where external_id is not null;

alter table public.lead_connections enable row level security;
drop policy if exists "Super admins read lead connections" on public.lead_connections;
create policy "Super admins read lead connections" on public.lead_connections
  for select to authenticated using (public.is_super_admin());

create table if not exists public.lead_connection_secrets (
  connection_id uuid primary key references public.lead_connections(id) on delete cascade,
  access_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.lead_connection_secrets enable row level security;
revoke all on public.lead_connection_secrets from anon, authenticated;

create table if not exists public.lead_oauth_handoffs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  user_token text not null,
  created_by uuid references public.app_users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now()
);
alter table public.lead_oauth_handoffs enable row level security;
revoke all on public.lead_oauth_handoffs from anon, authenticated;

-- Where each lead came from, and the provider's own id so a retried webhook
-- never creates the same lead twice.
alter table public.contact_requests
  add column if not exists connection_id uuid references public.lead_connections(id) on delete set null,
  add column if not exists external_id text,
  -- "Spring promo · Lead form A": campaign / ad / form, as the provider names them.
  add column if not exists source_detail text,
  add column if not exists is_test boolean not null default false,
  add column if not exists raw jsonb;

create unique index if not exists contact_requests_source_external
  on public.contact_requests (source, external_id) where external_id is not null;

-- Counters on the connection, bumped by the same insert.
create or replace function public.bump_lead_connection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.connection_id is not null then
    update public.lead_connections
    set lead_count = lead_count + 1, last_lead_at = new.created_at, status = 'active', last_error = null, updated_at = now()
    where id = new.connection_id;
  end if;
  return new;
end
$$;

drop trigger if exists trg_bump_lead_connection on public.contact_requests;
create trigger trg_bump_lead_connection
  after insert on public.contact_requests
  for each row execute function public.bump_lead_connection();
