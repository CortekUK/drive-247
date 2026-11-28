-- feat-003 · Driver verification, part 1 · spec 01 (the data).
-- APPLIED to staging (csjouxrkblpsoihyejel) 2026-11-28. Production: at the relay only.
--
-- A new module beside the old one: nothing here alters identity_verifications, and the old
-- customers.identity_verification_status column keeps being written (spec 03.8) so every screen
-- that reads it keeps working. Money is whole cents everywhere. Writes go through the edge
-- functions (service role); staff only read their own company's rows.

-- ── Types ────────────────────────────────────────────────────────────────────
do $$ begin
  create type public.verification_status_v2 as enum
    ('not_verified','link_sent','in_progress','verified','needs_review','failed','expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.verification_kind_v2 as enum ('free','premium');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.verification_avail_v2 as enum ('live','switched_off','coming_soon');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.verification_result_v2 as enum
    ('pending','pass','fail','could_not_check','not_run','not_set');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.verification_sent_via_v2 as enum ('email','sms','qr','copy');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.verification_event_v2 as enum
    ('session_created','link_emailed','link_texted','link_copied','code_shown','reminder_sent',
     'link_opened','consent_given','consent_refused','check_started','standard_result',
     'premium_started','premium_result','cancelled','expired','replaced');
exception when duplicate_object then null; end $$;

-- ── The price list ───────────────────────────────────────────────────────────
create table if not exists public.verification_services (
  key text primary key,
  name text not null,
  description text not null,
  kind public.verification_kind_v2 not null,
  availability public.verification_avail_v2 not null,
  provider text check (provider in ('didit','rentid')),
  provider_cost_cents integer not null default 0 check (provider_cost_cents >= 0),
  margin_cents integer not null default 0 check (margin_cents >= 0),
  has_state_fee boolean not null default false,
  needs_consent boolean not null default false,
  sort_order integer not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.verification_state_fees (
  service_key text not null references public.verification_services(key) on delete cascade,
  state char(2) not null check (state ~ '^[A-Z]{2}$'),
  fee_cents integer not null check (fee_cents >= 0),
  primary key (service_key, state)
);

-- ── Sessions, their checks, their moments ────────────────────────────────────
create table if not exists public.verification_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  started_by uuid references public.app_users(id) on delete set null,
  status public.verification_status_v2 not null default 'link_sent',
  token text not null unique check (length(token) >= 43),
  expires_at timestamptz not null,
  sent_via public.verification_sent_via_v2 not null,
  sent_to text,
  didit_session_id text unique,
  replaced_by uuid references public.verification_sessions(id) on delete set null,
  opened_at timestamptz,
  consent_at timestamptz,
  finished_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.app_users(id) on delete set null,
  consent_text_version text,
  reminders_sent integer not null default 0 check (reminders_sent >= 0),
  created_at timestamptz not null default now(),
  -- The booking site this session's link and Didit's return point at (spec 05.7).
  booking_origin text not null check (booking_origin ~ '^https://'),
  -- A simple per-link request limit for the renter's page (spec 06.20).
  link_hits integer not null default 0 check (link_hits >= 0),
  link_window_started_at timestamptz
);

create unique index if not exists verification_sessions_one_open_per_customer
  on public.verification_sessions (customer_id) where status in ('link_sent','in_progress');
create index if not exists verification_sessions_tenant_created on public.verification_sessions (tenant_id, created_at desc);
create index if not exists verification_sessions_customer_created on public.verification_sessions (customer_id, created_at desc);

create table if not exists public.verification_session_checks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.verification_sessions(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_key text not null references public.verification_services(key),
  provider_cost_cents integer not null check (provider_cost_cents >= 0),
  margin_cents integer not null check (margin_cents >= 0),
  state_fee_cents integer check (state_fee_cents >= 0),
  consent text check (consent in ('given','refused')),
  result public.verification_result_v2 not null default 'pending',
  lines jsonb not null default '[]'::jsonb,
  reason text,
  raw jsonb,
  provider_ref text,
  started_at timestamptz,
  finished_at timestamptz,
  unique (session_id, service_key)
);

create table if not exists public.verification_session_events (
  id bigserial primary key,
  session_id uuid not null references public.verification_sessions(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind public.verification_event_v2 not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists verification_session_events_session_at on public.verification_session_events (session_id, at);
-- A provider's retried webhook is recorded once (spec 07.10): its event id is unique.
create unique index if not exists verification_session_events_provider_event
  on public.verification_session_events ((detail->>'provider_event_id')) where detail ? 'provider_event_id';

-- ── Charges ──────────────────────────────────────────────────────────────────
create table if not exists public.verification_charges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  session_id uuid references public.verification_sessions(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  service_key text not null references public.verification_services(key),
  provider_cost_cents integer not null check (provider_cost_cents >= 0),
  state_fee_cents integer not null check (state_fee_cents >= 0),
  margin_cents integer not null check (margin_cents >= 0),
  total_cents integer generated always as (provider_cost_cents + state_fee_cents + margin_cents) stored not null,
  currency text not null default 'usd',
  stripe_account text check (stripe_account in ('uk','uae')),
  stripe_mode text check (stripe_mode in ('test','live')),
  stripe_invoice_item_id text unique,
  sent_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  unique (session_id, service_key)
);
create index if not exists verification_charges_tenant_created on public.verification_charges (tenant_id, created_at desc);
create index if not exists verification_charges_unsent on public.verification_charges (created_at) where sent_at is null;

-- ── The company's last ticks ─────────────────────────────────────────────────
create table if not exists public.verification_tenant_prefs (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  last_ticks text[] not null default '{standard}',
  updated_at timestamptz not null default now()
);

-- ── Customers ────────────────────────────────────────────────────────────────
alter table public.customers
  add column if not exists verification_status public.verification_status_v2 not null default 'not_verified',
  add column if not exists verification_session_id uuid references public.verification_sessions(id) on delete set null,
  add column if not exists verification_warning text,
  add column if not exists licence_expiry_date date,
  add column if not exists licence_document_type text,
  add column if not exists licence_document_subtype text,
  add column if not exists licence_issuing_country text,
  add column if not exists identity_details_source text
    check (identity_details_source in ('typed','verified'));

-- ── Row level security ───────────────────────────────────────────────────────
alter table public.verification_services enable row level security;
alter table public.verification_state_fees enable row level security;
alter table public.verification_sessions enable row level security;
alter table public.verification_session_checks enable row level security;
alter table public.verification_session_events enable row level security;
alter table public.verification_charges enable row level security;
alter table public.verification_tenant_prefs enable row level security;

revoke all on public.verification_services, public.verification_state_fees, public.verification_sessions,
  public.verification_session_checks, public.verification_session_events, public.verification_charges,
  public.verification_tenant_prefs from anon, public;
grant select on public.verification_services, public.verification_state_fees, public.verification_sessions,
  public.verification_session_checks, public.verification_session_events, public.verification_charges,
  public.verification_tenant_prefs to authenticated;
grant insert, update, delete on public.verification_services, public.verification_state_fees to authenticated;
grant all on public.verification_services, public.verification_state_fees, public.verification_sessions,
  public.verification_session_checks, public.verification_session_events, public.verification_charges,
  public.verification_tenant_prefs to service_role;
grant usage on sequence public.verification_session_events_id_seq to service_role;

drop policy if exists "price list readable by staff" on public.verification_services;
create policy "price list readable by staff" on public.verification_services for select to authenticated using (true);
drop policy if exists "price list written by super admins" on public.verification_services;
create policy "price list written by super admins" on public.verification_services for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "state fees readable by staff" on public.verification_state_fees;
create policy "state fees readable by staff" on public.verification_state_fees for select to authenticated using (true);
drop policy if exists "state fees written by super admins" on public.verification_state_fees;
create policy "state fees written by super admins" on public.verification_state_fees for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "own company sessions" on public.verification_sessions;
create policy "own company sessions" on public.verification_sessions for select to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists "own company session checks" on public.verification_session_checks;
create policy "own company session checks" on public.verification_session_checks for select to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists "own company session events" on public.verification_session_events;
create policy "own company session events" on public.verification_session_events for select to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists "own company charges" on public.verification_charges;
create policy "own company charges" on public.verification_charges for select to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists "own company prefs" on public.verification_tenant_prefs;
create policy "own company prefs" on public.verification_tenant_prefs for select to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());

-- ── The one place the customer's two status columns are written (spec 03.8, 05.16) ──
create or replace function public.verification_v2_set_customer_status(
  p_customer uuid, p_session uuid, p_status public.verification_status_v2
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_latest uuid;
  v_old text;
begin
  -- Only the customer's latest session may move them (a replaced one never can).
  select id into v_latest from verification_sessions
   where customer_id = p_customer order by created_at desc, id desc limit 1;
  if v_latest is distinct from p_session then
    return false;
  end if;

  select identity_verification_status into v_old from customers where id = p_customer;

  update customers set
    verification_status = p_status,
    verification_session_id = p_session,
    identity_verification_status = case
      -- staff's manual verification stands until a new session finishes
      when v_old = 'manually_verified' and p_status in ('link_sent','in_progress','expired','not_verified') then v_old
      when p_status = 'verified' then 'verified'
      when p_status = 'failed' then 'rejected'
      when p_status in ('link_sent','in_progress','needs_review') then 'pending'
      else 'unverified'
    end
  where id = p_customer;
  return true;
end;
$function$;

revoke all on function public.verification_v2_set_customer_status(uuid, uuid, public.verification_status_v2) from public, anon, authenticated;
grant execute on function public.verification_v2_set_customer_status(uuid, uuid, public.verification_status_v2) to service_role;

-- ── Private photo storage (spec 12.2) ────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('verification-documents', 'verification-documents', false)
on conflict (id) do update set public = false;

-- ── The price list at launch (spec 09.13; assumptions A1 to A3) ──────────────
insert into public.verification_services
  (key, name, description, kind, availability, provider, provider_cost_cents, margin_cents, has_state_fee, needs_consent, sort_order)
values
  ('standard', 'Standard check',
   'Real licence, live person, face match, age, name, licence type, blocked list. Saves their details.',
   'free', 'live', 'didit', 33, 0, false, true, 10),
  ('licence_status', 'Licence active with the state',
   'Not suspended, revoked or cancelled.',
   'premium', 'live', 'rentid', 299, 50, true, true, 20),
  ('driving_record', 'Driving record',
   'Points, DUIs, accidents, past suspensions.',
   'premium', 'switched_off', 'rentid', 299, 50, true, true, 30),
  ('criminal_record', 'Criminal record',
   'Any criminal history.',
   'premium', 'switched_off', 'rentid', 299, 50, false, true, 40),
  ('licence_watch', 'Licence watch during the rental',
   'Tells you if the licence is suspended mid-rental.',
   'premium', 'coming_soon', null, 0, 0, false, false, 50),
  ('rideshare_proof', 'Rideshare driver proof',
   'They are an active Uber or Lyft driver.',
   'premium', 'coming_soon', null, 0, 0, false, false, 60)
on conflict (key) do nothing;
