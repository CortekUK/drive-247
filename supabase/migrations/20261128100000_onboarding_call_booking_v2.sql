-- =============================================================================
-- Onboarding call with Bryan, v2 (feat-001, 28 Nov 2026).
-- Specs: docs/application/feat-001-call-booking/specs/
--
--   spec 01  new columns on bookings; history, blocked periods, email ledger
--   spec 02  ONE place that decides a free time (problem check + free slots)
--   spec 04  the portal's functions: owners only, move in place, waiting calls
--   spec 05  Bryan's actions, list, counts, details
--   spec 06  settings saved through one function, with the clash check
--   spec 08  email queue, reminders, claim for the mailer
--
-- Additive: no column is dropped or renamed. The production booking keeps its
-- values (spec 01.20). The pg_cron job for the mailer is NOT here: it carries
-- the project's own URL, so it is created per project (see spec 08).
-- =============================================================================

begin;

-- ── Spec 01: data ──────────────────────────────────────────────────────────

alter table public.onboarding_call_bookings
  add column if not exists customer_timezone text,
  add column if not exists booked_via        text not null default 'portal',
  add column if not exists cancel_reason     text,
  add column if not exists sequence          integer not null default 0,
  add column if not exists ics_token         uuid not null default gen_random_uuid(),
  add column if not exists rescheduled_at    timestamptz;

update public.onboarding_call_bookings set rescheduled_at = created_at where rescheduled_at is null;

do $$ begin
  alter table public.onboarding_call_bookings add constraint onboarding_call_bookings_booked_via_check check (booked_via in ('portal', 'admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.onboarding_call_bookings add constraint onboarding_call_bookings_cancel_reason_check check (cancel_reason is null or length(cancel_reason) <= 500);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.onboarding_call_bookings add constraint onboarding_call_bookings_sequence_check check (sequence >= 0);
exception when duplicate_object then null; end $$;

alter table public.onboarding_call_bookings drop constraint if exists onboarding_call_bookings_cancelled_by_check;
alter table public.onboarding_call_bookings add constraint onboarding_call_bookings_cancelled_by_check
  check (cancelled_by is null or cancelled_by in ('operator', 'admin', 'system'));

create unique index if not exists onboarding_call_bookings_ics_token on public.onboarding_call_bookings (ics_token);

create or replace function public.onboarding_call_bookings_check()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.customer_timezone is not null
     and not exists (select 1 from pg_timezone_names where name = new.customer_timezone) then
    raise exception 'Unknown time zone %', new.customer_timezone using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists onboarding_call_bookings_check on public.onboarding_call_bookings;
create trigger onboarding_call_bookings_check
  before insert or update of customer_timezone on public.onboarding_call_bookings
  for each row execute function public.onboarding_call_bookings_check();

do $$ begin
  create type public.onboarding_call_event_kind as enum ('booked', 'moved', 'cancelled', 'completed', 'missed', 'reopened');
exception when duplicate_object then null; end $$;

create table if not exists public.onboarding_call_history (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.onboarding_call_bookings(id) on delete cascade,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  kind           public.onboarding_call_event_kind not null,
  actor          text not null check (actor in ('operator', 'admin', 'system')),
  actor_user_id  uuid references public.app_users(id) on delete set null,
  from_starts_at timestamptz,
  to_starts_at   timestamptz,
  reason         text check (reason is null or length(reason) <= 500),
  created_at     timestamptz not null default now()
);
create index if not exists onboarding_call_history_booking on public.onboarding_call_history (booking_id, created_at);

create table if not exists public.onboarding_call_blocks (
  id         uuid primary key default gen_random_uuid(),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  label      text check (label is null or length(label) <= 80),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists onboarding_call_blocks_range on public.onboarding_call_blocks (starts_at, ends_at);

do $$ begin
  create type public.onboarding_call_email_kind as enum (
    'booked_company', 'booked_host', 'moved_company', 'moved_host',
    'cancelled_company', 'cancelled_host', 'reminder_day', 'reminder_hour', 'missed');
exception when duplicate_object then null; end $$;

create table if not exists public.onboarding_call_emails (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.onboarding_call_bookings(id) on delete cascade,
  kind        public.onboarding_call_email_kind not null,
  recipient   text not null,
  dedupe_key  text not null unique,
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts    integer not null default 0,
  error       text,
  claimed_at  timestamptz,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists onboarding_call_emails_status on public.onboarding_call_emails (status, created_at);

alter table public.onboarding_call_history enable row level security;
alter table public.onboarding_call_blocks enable row level security;
alter table public.onboarding_call_emails enable row level security;

drop policy if exists "Super admins read call history" on public.onboarding_call_history;
create policy "Super admins read call history" on public.onboarding_call_history for select using (public.is_super_admin());
drop policy if exists "Super admins read call blocks" on public.onboarding_call_blocks;
create policy "Super admins read call blocks" on public.onboarding_call_blocks for select using (public.is_super_admin());
drop policy if exists "Super admins read call emails" on public.onboarding_call_emails;
create policy "Super admins read call emails" on public.onboarding_call_emails for select using (public.is_super_admin());

revoke all on public.onboarding_call_history, public.onboarding_call_blocks, public.onboarding_call_emails from anon, authenticated;
grant select on public.onboarding_call_history, public.onboarding_call_blocks, public.onboarding_call_emails to authenticated;
grant all on public.onboarding_call_history, public.onboarding_call_blocks, public.onboarding_call_emails to service_role;

-- Settings change only through admin_save_onboarding_call_settings (spec 06.1).
revoke insert, update, delete on public.onboarding_call_settings from anon, authenticated;
revoke insert, update, delete on public.onboarding_call_bookings from anon, authenticated;
revoke all on public.onboarding_call_settings, public.onboarding_call_bookings from anon;
grant select on public.onboarding_call_settings, public.onboarding_call_bookings to authenticated;
grant all on public.onboarding_call_settings, public.onboarding_call_bookings to service_role;
drop policy if exists "Super admins update call settings" on public.onboarding_call_settings;

do $$ begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'onboarding_call_bookings') then
    alter publication supabase_realtime add table public.onboarding_call_bookings;
  end if;
end $$;

-- ── Spec 02: the one place that decides a free time ─────────────────────────

create or replace function public.onboarding_call_message(p_code text)
returns text
language sql
immutable
as $$
  select case p_code
    when 'not_accepting' then 'Bryan is not taking new calls right now'
    when 'past'          then 'That time has passed. Please pick another.'
    when 'too_soon'      then 'That time is too soon. Please pick a later one.'
    when 'too_far'       then 'That time is too far ahead. Please pick an earlier one.'
    when 'taken'         then 'Someone has just taken that time. Please pick another.'
    when 'day_off'       then 'Bryan is not available then. Please pick another time.'
    when 'outside_hours' then 'Bryan is not available then. Please pick another time.'
    when 'off_grid'      then 'Bryan is not available then. Please pick another time.'
    when 'blocked'       then 'Bryan is not available then. Please pick another time.'
    else 'That time cannot be booked. Please pick another.'
  end
$$;

create or replace function public.onboarding_call_refuse(p_code text)
returns void
language plpgsql
as $$
begin
  raise exception '%', public.onboarding_call_message(p_code) using errcode = 'P0001', detail = p_code;
end $$;

-- Minutes from midnight; '24:00' is 1440.
create or replace function public.onboarding_call_minutes(p_hhmm text)
returns integer
language sql
immutable
as $$ select (extract(epoch from p_hhmm::time) / 60)::int $$;

-- Does [start, end) sit inside one of that weekday's windows, in Bryan's
-- zone, on one date? Returns 'outside_hours', 'off_grid' or null. The grid
-- is checked only when p_grid is true (a booked call that is kept after a
-- change of call length is not off the grid, spec 06.13).
create or replace function public.onboarding_call_fit(
  s public.onboarding_call_settings, p_start timestamptz, p_end timestamptz, p_grid boolean)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_local     timestamp := p_start at time zone s.timezone;
  v_local_end timestamp := p_end at time zone s.timezone;
  v_start     integer;
  v_end       integer;
  v_inside    boolean := false;
  w           jsonb;
begin
  if v_local_end::date <> v_local::date then
    -- A call that ends exactly at midnight ends on the next date.
    if not (v_local_end::date = v_local::date + 1 and v_local_end::time = '00:00') then
      return 'outside_hours';
    end if;
  end if;
  v_start := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_end   := case when v_local_end::date > v_local::date then 1440
                  else extract(hour from v_local_end)::int * 60 + extract(minute from v_local_end)::int end;
  for w in
    select value from jsonb_array_elements(coalesce(s.weekly_hours -> extract(dow from v_local)::int::text, '[]'::jsonb))
  loop
    if v_start >= public.onboarding_call_minutes(w ->> 0) and v_end <= public.onboarding_call_minutes(w ->> 1) then
      v_inside := true;
      if not p_grid then return null; end if;
      if extract(second from v_local) = 0
         and (v_start - public.onboarding_call_minutes(w ->> 0)) % s.duration_minutes = 0 then
        return null;
      end if;
    end if;
  end loop;
  return case when v_inside then 'off_grid' else 'outside_hours' end;
end $$;

-- Spec 02.1 to 02.9, in that order. Null when the time is free.
create or replace function public.onboarding_call_slot_problem(
  s             public.onboarding_call_settings,
  p_starts_at   timestamptz,
  p_now         timestamptz,
  p_skip_notice boolean default false,
  p_exclude     uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_end   timestamptz := p_starts_at + make_interval(mins => s.duration_minutes);
  v_local timestamp   := p_starts_at at time zone s.timezone;
  v_fit   text;
begin
  if not s.is_accepting then return 'not_accepting'; end if;
  if p_starts_at <= p_now then return 'past'; end if;
  if not p_skip_notice and p_starts_at < p_now + make_interval(hours => s.min_notice_hours) then return 'too_soon'; end if;
  if p_starts_at > p_now + make_interval(days => s.max_days_ahead) then return 'too_far'; end if;
  if v_local::date = any (s.blocked_dates) then return 'day_off'; end if;
  v_fit := public.onboarding_call_fit(s, p_starts_at, v_end, true);
  if v_fit is not null then return v_fit; end if;
  -- A wall time that happens twice (clocks going back) is offered once:
  -- the occurrence Postgres reads the wall time as (spec 02.18).
  if (v_local at time zone s.timezone) <> p_starts_at then return 'off_grid'; end if;
  if exists (select 1 from public.onboarding_call_blocks k
              where k.starts_at < v_end and k.ends_at > p_starts_at) then
    return 'blocked';
  end if;
  if exists (select 1 from public.onboarding_call_bookings b
              where b.status = 'booked'
                and b.id is distinct from p_exclude
                and b.starts_at < v_end + make_interval(mins => s.buffer_minutes)
                and b.ends_at + make_interval(mins => s.buffer_minutes) > p_starts_at) then
    return 'taken';
  end if;
  return null;
end $$;

-- Spec 02.13: every grid start with no problem, earliest first. Built on the
-- check above, so the list and the check cannot disagree (02.14).
create or replace function public.onboarding_call_free_slots(
  s             public.onboarding_call_settings,
  p_now         timestamptz,
  p_skip_notice boolean default false,
  p_exclude     uuid default null)
returns setof timestamptz
language sql
stable
security definer
set search_path = public
as $$
  with days as (
    select d::date as day
      from generate_series((p_now at time zone s.timezone)::date,
                           (p_now at time zone s.timezone)::date + s.max_days_ahead + 1,
                           interval '1 day') d
  ), wins as (
    select day, public.onboarding_call_minutes(w ->> 0) as f, public.onboarding_call_minutes(w ->> 1) as t
      from days, jsonb_array_elements(coalesce(s.weekly_hours -> extract(dow from day)::int::text, '[]'::jsonb)) w
  ), cands as (
    select day + make_interval(mins => m) as local
      from wins, generate_series(f, t - s.duration_minutes, s.duration_minutes) m
  )
  select distinct c.local at time zone s.timezone as at
    from cands c
   -- A wall time that does not exist that day (clocks going forward) reads
   -- back as another time: skip it (spec 02.17).
   where ((c.local at time zone s.timezone) at time zone s.timezone) = c.local
     and public.onboarding_call_slot_problem(s, c.local at time zone s.timezone, p_now, p_skip_notice, p_exclude) is null
   order by 1
$$;

create or replace function public.onboarding_call_settings_row(p_overlay jsonb default null)
returns public.onboarding_call_settings
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.onboarding_call_settings;
begin
  select * into s from public.onboarding_call_settings where id;
  if s.id is null then
    raise exception 'The call calendar has no settings yet' using errcode = 'P0002';
  end if;
  if p_overlay is not null then
    s := jsonb_populate_record(s, p_overlay - 'id');
  end if;
  return s;
end $$;

create or replace function public.preview_onboarding_call_slots(
  p_settings jsonb default null, p_now timestamptz default now(), p_skip_notice boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.onboarding_call_settings;
begin
  if not public.is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  s := public.onboarding_call_settings_row(p_settings);
  return jsonb_build_object('slots', coalesce((
    select jsonb_agg(x order by x) from public.onboarding_call_free_slots(s, p_now, p_skip_notice, null) x), '[]'::jsonb));
end $$;

create or replace function public.check_onboarding_call_slot(
  p_starts_at timestamptz, p_settings jsonb default null, p_now timestamptz default now(), p_skip_notice boolean default false)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  return public.onboarding_call_slot_problem(public.onboarding_call_settings_row(p_settings), p_starts_at, p_now, p_skip_notice, null);
end $$;

-- ── Helpers shared by the actions ───────────────────────────────────────────

create or replace function public.onboarding_call_app_user()
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select id from public.app_users where auth_user_id = auth.uid() limit 1 $$;

-- Spec 04.1: an owner is a head admin or an admin of the company.
create or replace function public.onboarding_call_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_users u
                  where u.auth_user_id = auth.uid()
                    and u.tenant_id is not null
                    and u.role in ('head_admin', 'admin')
                    and coalesce(u.is_active, true))
$$;

create or replace function public.onboarding_call_log(
  p_booking uuid, p_tenant uuid, p_kind public.onboarding_call_event_kind, p_actor text,
  p_from timestamptz default null, p_to timestamptz default null, p_reason text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.onboarding_call_history (booking_id, tenant_id, kind, actor, actor_user_id, from_starts_at, to_starts_at, reason)
  values (p_booking, p_tenant, p_kind, p_actor, public.onboarding_call_app_user(), p_from, p_to, p_reason)
$$;

-- Spec 08.1 to 08.3: queue one email with a snapshot of what it needs.
create or replace function public.onboarding_call_queue_email(
  p_booking uuid, p_kind public.onboarding_call_email_kind, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.onboarding_call_bookings;
  s public.onboarding_call_settings;
  t record;
  v_host boolean := p_kind in ('booked_host', 'moved_host', 'cancelled_host');
  v_key  text;
begin
  select * into b from public.onboarding_call_bookings where id = p_booking;
  select * into s from public.onboarding_call_settings where id;
  select company_name, slug, timezone into t from public.tenants where id = b.tenant_id;
  v_key := b.id || ':' || p_kind || ':' ||
           case when p_kind in ('reminder_day', 'reminder_hour')
                then extract(epoch from b.starts_at)::bigint::text
                else b.sequence::text end;
  insert into public.onboarding_call_emails (booking_id, kind, recipient, dedupe_key, payload)
  values (b.id, p_kind,
          case when v_host then coalesce(s.host_email, '') else b.email end,
          v_key,
          jsonb_build_object(
            'booking_id', b.id, 'sequence', b.sequence, 'ics_token', b.ics_token,
            'name', b.name, 'email', b.email, 'phone', b.phone, 'notes', b.notes,
            'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
            'customer_timezone', b.customer_timezone,
            'company_name', coalesce(t.company_name, t.slug), 'slug', t.slug,
            'host_name', s.host_name, 'host_email', s.host_email,
            'host_timezone', s.timezone, 'meeting_url', s.meeting_url
          ) || coalesce(p_extra, '{}'::jsonb))
  on conflict (dedupe_key) do nothing;
end $$;

-- Puts the company's journey row (read by the card, the tracker and the
-- "book your call" emails) in line with its bookings.
create or replace function public.onboarding_call_sync_journey(p_tenant uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live public.onboarding_call_bookings;
begin
  select * into v_live from public.onboarding_call_bookings
   where tenant_id = p_tenant and status = 'booked' limit 1;
  insert into public.tenant_onboarding_calls (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  update public.tenant_onboarding_calls set
    call_booked_at     = case when v_live.id is not null then coalesce(call_booked_at, now()) else null end,
    call_booked_via    = case when v_live.id is not null then 'calendar' else null end,
    call_scheduled_for = v_live.starts_at,
    call_cancelled_at  = case when v_live.id is not null then null
                              when p_event = 'cancelled' then now() else call_cancelled_at end,
    call_missed_at     = case when v_live.id is not null then null
                              when p_event = 'missed' then now() else call_missed_at end,
    call_completed_at  = case when p_event = 'completed' then coalesce(call_completed_at, now())
                              when p_event = 'reopened' then null else call_completed_at end
   where tenant_id = p_tenant;
end $$;

-- ── Spec 04: the portal ─────────────────────────────────────────────────────

drop function if exists public.book_onboarding_call(timestamptz, text, text, text, text);
drop function if exists public.cancel_my_onboarding_call();

create or replace function public.onboarding_call_on_offer(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.onboarding_call_eligible(p_tenant)
      or exists (select 1 from public.onboarding_call_bookings b where b.tenant_id = p_tenant and b.status = 'booked')
$$;

create or replace function public.get_onboarding_call_calendar()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  s        public.onboarding_call_settings;
  v_mine   public.onboarding_call_bookings;
begin
  if v_tenant is null and not public.is_super_admin() then
    raise exception 'Sign in to book a call' using errcode = '42501';
  end if;
  s := public.onboarding_call_settings_row();
  if v_tenant is not null then
    select * into v_mine from public.onboarding_call_bookings
     where tenant_id = v_tenant and status = 'booked' limit 1;
  end if;
  return jsonb_build_object(
    'host_name',        s.host_name,
    'host_title',       s.host_title,
    'host_photo_url',   s.host_photo_url,
    'duration_minutes', s.duration_minutes,
    'timezone',         s.timezone,
    'max_days_ahead',   s.max_days_ahead,
    'is_accepting',     s.is_accepting,
    'meeting_url',      case when v_mine.id is not null then s.meeting_url end,
    'slots', coalesce((
      select jsonb_agg(x order by x)
        from public.onboarding_call_free_slots(s, now(), false, v_mine.id) x), '[]'::jsonb),
    'mine', case when v_mine.id is null then null else jsonb_build_object(
      'id', v_mine.id, 'name', v_mine.name, 'email', v_mine.email, 'phone', v_mine.phone,
      'notes', v_mine.notes, 'starts_at', v_mine.starts_at, 'ends_at', v_mine.ends_at,
      'customer_timezone', v_mine.customer_timezone, 'ics_token', v_mine.ics_token,
      'waiting', v_mine.starts_at <= now()) end
  );
end $$;

create or replace function public.onboarding_call_check_details(p_name text, p_email text, p_phone text, p_notes text)
returns void
language plpgsql
immutable
as $$
begin
  if length(trim(coalesce(p_name, ''))) not between 1 and 120
     or position('@' in trim(coalesce(p_email, ''))) <= 1
     or length(trim(p_email)) > 254
     or length(coalesce(p_phone, '')) > 40
     or length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Please check your details' using errcode = '22023';
  end if;
end $$;

create or replace function public.book_onboarding_call(
  p_starts_at timestamptz,
  p_name      text,
  p_email     text,
  p_phone     text default null,
  p_notes     text default null,
  p_timezone  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  s        public.onboarding_call_settings;
  v_old    public.onboarding_call_bookings;
  v_end    timestamptz;
  v_code   text;
  v_id     uuid;
  v_moved  boolean := false;
begin
  if v_tenant is null then
    raise exception 'There is no company on this login to book for' using errcode = '42501';
  end if;
  if not public.onboarding_call_on_offer(v_tenant) then
    raise exception 'The onboarding call is not available for this account' using errcode = '42501';
  end if;
  if not public.onboarding_call_is_owner() then
    raise exception 'Only the account owner can book the onboarding call' using errcode = '42501';
  end if;
  perform public.onboarding_call_check_details(p_name, p_email, p_phone, p_notes);

  perform pg_advisory_xact_lock(hashtext('onboarding_call_booking'));
  s := public.onboarding_call_settings_row();

  select * into v_old from public.onboarding_call_bookings
   where tenant_id = v_tenant and status = 'booked' limit 1;

  -- Spec 04.20: a call whose time has passed is closed as missed, quietly.
  if v_old.id is not null and v_old.starts_at <= now() then
    update public.onboarding_call_bookings
       set status = 'missed'
     where id = v_old.id;
    perform public.onboarding_call_log(v_old.id, v_tenant, 'missed', 'system');
    v_old := null;
  end if;

  v_code := public.onboarding_call_slot_problem(s, p_starts_at, now(), false, v_old.id);
  if v_code is not null then perform public.onboarding_call_refuse(v_code); end if;

  v_end := p_starts_at + make_interval(mins => s.duration_minutes);

  if v_old.id is not null then
    -- Spec 04.15: a move keeps the booking and its invite.
    update public.onboarding_call_bookings
       set starts_at = p_starts_at, ends_at = v_end, sequence = sequence + 1, rescheduled_at = now(),
           name = trim(p_name), email = lower(trim(p_email)),
           phone = nullif(trim(coalesce(p_phone, '')), ''), notes = nullif(trim(coalesce(p_notes, '')), ''),
           customer_timezone = coalesce(p_timezone, customer_timezone)
     where id = v_old.id;
    v_id := v_old.id;
    v_moved := true;
    perform public.onboarding_call_log(v_id, v_tenant, 'moved', 'operator', v_old.starts_at, p_starts_at);
    perform public.onboarding_call_queue_email(v_id, 'moved_company', jsonb_build_object('old_starts_at', v_old.starts_at, 'actor', 'operator'));
    perform public.onboarding_call_queue_email(v_id, 'moved_host',    jsonb_build_object('old_starts_at', v_old.starts_at, 'actor', 'operator'));
  else
    insert into public.onboarding_call_bookings
      (tenant_id, booked_by, name, email, phone, notes, starts_at, ends_at, customer_timezone, booked_via, rescheduled_at)
    values (v_tenant, public.onboarding_call_app_user(), trim(p_name), lower(trim(p_email)),
            nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_notes, '')), ''),
            p_starts_at, v_end, p_timezone, 'portal', now())
    returning id into v_id;
    perform public.onboarding_call_log(v_id, v_tenant, 'booked', 'operator', null, p_starts_at);
    perform public.onboarding_call_queue_email(v_id, 'booked_company', jsonb_build_object('actor', 'operator'));
    perform public.onboarding_call_queue_email(v_id, 'booked_host',    jsonb_build_object('actor', 'operator'));
  end if;

  perform public.onboarding_call_sync_journey(v_tenant, 'booked');

  return jsonb_build_object(
    'id', v_id, 'starts_at', p_starts_at, 'ends_at', v_end, 'moved', v_moved,
    'meeting_url', s.meeting_url, 'host_name', s.host_name, 'timezone', s.timezone,
    'ics_token', (select ics_token from public.onboarding_call_bookings where id = v_id));
end $$;

create or replace function public.onboarding_call_cancel(
  b public.onboarding_call_bookings, p_actor text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.onboarding_call_bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor,
         cancel_reason = nullif(trim(coalesce(p_reason, '')), ''), sequence = sequence + 1
   where id = b.id;
  perform public.onboarding_call_log(b.id, b.tenant_id, 'cancelled', p_actor, b.starts_at, null, nullif(trim(coalesce(p_reason, '')), ''));
  perform public.onboarding_call_queue_email(b.id, 'cancelled_company', jsonb_build_object('actor', p_actor, 'reason', nullif(trim(coalesce(p_reason, '')), '')));
  perform public.onboarding_call_queue_email(b.id, 'cancelled_host',    jsonb_build_object('actor', p_actor, 'reason', nullif(trim(coalesce(p_reason, '')), '')));
  perform public.onboarding_call_sync_journey(b.tenant_id, 'cancelled');
end $$;

create or replace function public.cancel_my_onboarding_call(p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  b        public.onboarding_call_bookings;
begin
  if v_tenant is null then
    raise exception 'There is no company on this login to book for' using errcode = '42501';
  end if;
  if not public.onboarding_call_is_owner() then
    raise exception 'Only the account owner can book the onboarding call' using errcode = '42501';
  end if;
  if length(coalesce(p_reason, '')) > 500 then
    raise exception 'Please keep the reason under 500 characters' using errcode = '22023';
  end if;
  select * into b from public.onboarding_call_bookings where tenant_id = v_tenant and status = 'booked' limit 1;
  if b.id is null then return; end if;
  if b.starts_at <= now() then
    raise exception 'This call has already started.' using errcode = 'P0001';
  end if;
  perform public.onboarding_call_cancel(b, 'operator', p_reason);
end $$;

create or replace function public.get_my_onboarding_call()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_row    public.tenant_onboarding_calls;
  v_live   public.onboarding_call_bookings;
  v_offer  boolean;
  v_state  text;
begin
  if v_tenant is null then return null; end if;
  select * into v_row from public.tenant_onboarding_calls where tenant_id = v_tenant;
  select * into v_live from public.onboarding_call_bookings where tenant_id = v_tenant and status = 'booked' limit 1;
  v_offer := public.onboarding_call_on_offer(v_tenant);
  v_state := case
    when not v_offer or v_row.dismissed_at is not null or v_row.call_completed_at is not null then 'none'
    when v_live.id is not null and v_live.starts_at <= now() then 'waiting'
    when v_live.id is not null then 'booked'
    -- A booking from the old outside calendar, with no booking row.
    when v_row.call_booked_at is not null then 'booked'
    else 'offer' end;
  return jsonb_build_object(
    'eligible',          v_offer,
    'call_state',        v_state,
    'call_booked_at',    v_row.call_booked_at,
    'call_scheduled_for', coalesce(v_live.starts_at, v_row.call_scheduled_for),
    'call_completed_at', v_row.call_completed_at,
    'site_previewed_at', v_row.site_previewed_at,
    'dismissed_at',      v_row.dismissed_at,
    'booking', case when v_live.id is null then null else jsonb_build_object(
      'id', v_live.id, 'starts_at', v_live.starts_at, 'ends_at', v_live.ends_at,
      'customer_timezone', v_live.customer_timezone, 'ics_token', v_live.ics_token,
      'meeting_url', (select meeting_url from public.onboarding_call_settings where id)) end,
    'vehicle_count',     (select count(*) from public.vehicles where tenant_id = v_tenant),
    'has_logo',          (select nullif(trim(logo_url), '') is not null from public.tenants where id = v_tenant)
  );
end $$;

-- ── Spec 05: Bryan's actions ────────────────────────────────────────────────

create or replace function public.onboarding_call_require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
end $$;

create or replace function public.admin_set_onboarding_call_booking(
  p_id          uuid,
  p_status      public.onboarding_call_booking_status,
  p_admin_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b      public.onboarding_call_bookings;
  s      public.onboarding_call_settings;
  v_code text;
begin
  perform public.onboarding_call_require_admin();
  perform pg_advisory_xact_lock(hashtext('onboarding_call_booking'));
  select * into b from public.onboarding_call_bookings where id = p_id for update;
  if b.id is null then
    raise exception 'No such booking' using errcode = 'P0002';
  end if;
  if p_admin_notes is not null then
    update public.onboarding_call_bookings set admin_notes = p_admin_notes where id = p_id;
  end if;
  if p_status = b.status then return; end if;

  if p_status = 'cancelled' then
    raise exception 'Use admin_cancel_onboarding_call to cancel, with a reason' using errcode = '22023';
  end if;

  if p_status in ('completed', 'missed') then
    if b.starts_at > now() then
      raise exception 'This call has not happened yet.' using errcode = 'P0001';
    end if;
    update public.onboarding_call_bookings set status = p_status where id = p_id;
    perform public.onboarding_call_log(p_id, b.tenant_id, p_status::text::public.onboarding_call_event_kind, 'admin');
    if p_status = 'missed' then
      perform public.onboarding_call_queue_email(p_id, 'missed', jsonb_build_object('actor', 'admin'));
    end if;
    perform public.onboarding_call_sync_journey(b.tenant_id, p_status::text);
    return;
  end if;

  -- Putting it back (spec 05.6, 05.7).
  if exists (select 1 from public.onboarding_call_bookings x
              where x.tenant_id = b.tenant_id and x.status = 'booked' and x.id <> b.id) then
    raise exception 'That company already has another call booked.' using errcode = 'P0001';
  end if;
  if b.status = 'cancelled' then
    s := public.onboarding_call_settings_row();
    v_code := public.onboarding_call_slot_problem(s, b.starts_at, now(), true, b.id);
    if v_code is not null then perform public.onboarding_call_refuse(v_code); end if;
  end if;
  update public.onboarding_call_bookings
     set status = 'booked', cancelled_at = null, cancelled_by = null, cancel_reason = null
   where id = p_id;
  perform public.onboarding_call_log(p_id, b.tenant_id, 'reopened', 'admin');
  perform public.onboarding_call_sync_journey(b.tenant_id, 'reopened');
end $$;

create or replace function public.admin_note_onboarding_call(p_id uuid, p_admin_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.onboarding_call_require_admin();
  update public.onboarding_call_bookings set admin_notes = nullif(trim(coalesce(p_admin_notes, '')), '') where id = p_id;
  if not found then raise exception 'No such booking' using errcode = 'P0002'; end if;
end $$;

create or replace function public.admin_cancel_onboarding_call(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.onboarding_call_bookings;
begin
  perform public.onboarding_call_require_admin();
  if length(trim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'Please give a reason.' using errcode = '22023';
  end if;
  select * into b from public.onboarding_call_bookings where id = p_id for update;
  if b.id is null then raise exception 'No such booking' using errcode = 'P0002'; end if;
  if b.status <> 'booked' then
    raise exception 'This call is not booked.' using errcode = 'P0001';
  end if;
  perform public.onboarding_call_cancel(b, 'admin', p_reason);
end $$;

create or replace function public.admin_move_onboarding_call(p_id uuid, p_starts_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b      public.onboarding_call_bookings;
  s      public.onboarding_call_settings;
  v_code text;
  v_end  timestamptz;
begin
  perform public.onboarding_call_require_admin();
  perform pg_advisory_xact_lock(hashtext('onboarding_call_booking'));
  select * into b from public.onboarding_call_bookings where id = p_id for update;
  if b.id is null then raise exception 'No such booking' using errcode = 'P0002'; end if;
  if b.status <> 'booked' then raise exception 'This call is not booked.' using errcode = 'P0001'; end if;
  s := public.onboarding_call_settings_row();
  v_code := public.onboarding_call_slot_problem(s, p_starts_at, now(), true, b.id);
  if v_code is not null then perform public.onboarding_call_refuse(v_code); end if;
  v_end := p_starts_at + make_interval(mins => s.duration_minutes);
  update public.onboarding_call_bookings
     set starts_at = p_starts_at, ends_at = v_end, sequence = sequence + 1, rescheduled_at = now()
   where id = p_id;
  perform public.onboarding_call_log(p_id, b.tenant_id, 'moved', 'admin', b.starts_at, p_starts_at);
  perform public.onboarding_call_queue_email(p_id, 'moved_company', jsonb_build_object('old_starts_at', b.starts_at, 'actor', 'admin'));
  perform public.onboarding_call_queue_email(p_id, 'moved_host',    jsonb_build_object('old_starts_at', b.starts_at, 'actor', 'admin'));
  perform public.onboarding_call_sync_journey(b.tenant_id, 'booked');
  return jsonb_build_object('starts_at', p_starts_at, 'ends_at', v_end);
end $$;

create or replace function public.admin_book_onboarding_call(
  p_tenant_id uuid, p_starts_at timestamptz, p_name text, p_email text,
  p_phone text default null, p_notes text default null, p_timezone text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s      public.onboarding_call_settings;
  v_code text;
  v_id   uuid;
  v_tz   text;
begin
  perform public.onboarding_call_require_admin();
  perform public.onboarding_call_check_details(p_name, p_email, p_phone, p_notes);
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'No such company' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('onboarding_call_booking'));
  if exists (select 1 from public.onboarding_call_bookings where tenant_id = p_tenant_id and status = 'booked') then
    raise exception 'That company already has another call booked.' using errcode = 'P0001';
  end if;
  s := public.onboarding_call_settings_row();
  v_code := public.onboarding_call_slot_problem(s, p_starts_at, now(), true, null);
  if v_code is not null then perform public.onboarding_call_refuse(v_code); end if;
  v_tz := coalesce(p_timezone,
                   (select t.timezone from public.tenants t
                     where t.id = p_tenant_id and exists (select 1 from pg_timezone_names z where z.name = t.timezone)),
                   s.timezone);
  insert into public.onboarding_call_bookings
    (tenant_id, booked_by, name, email, phone, notes, starts_at, ends_at, customer_timezone, booked_via, rescheduled_at)
  values (p_tenant_id, public.onboarding_call_app_user(), trim(p_name), lower(trim(p_email)),
          nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_notes, '')), ''),
          p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes), v_tz, 'admin', now())
  returning id into v_id;
  perform public.onboarding_call_log(v_id, p_tenant_id, 'booked', 'admin', null, p_starts_at);
  perform public.onboarding_call_queue_email(v_id, 'booked_company', jsonb_build_object('actor', 'admin'));
  perform public.onboarding_call_queue_email(v_id, 'booked_host',    jsonb_build_object('actor', 'admin'));
  perform public.onboarding_call_sync_journey(p_tenant_id, 'booked');
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.admin_onboarding_call_free_slots(p_exclude uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.onboarding_call_require_admin();
  return coalesce((select jsonb_agg(x order by x)
                     from public.onboarding_call_free_slots(public.onboarding_call_settings_row(), now(), true, p_exclude) x),
                  '[]'::jsonb);
end $$;

create or replace function public.admin_onboarding_call_counts(p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tz      text;
  v_today date;
begin
  perform public.onboarding_call_require_admin();
  select timezone into tz from public.onboarding_call_settings where id;
  v_today := (p_now at time zone tz)::date;
  return jsonb_build_object(
    'today', (select count(*) from public.onboarding_call_bookings
               where status <> 'cancelled' and (starts_at at time zone tz)::date = v_today),
    'week', (select count(*) from public.onboarding_call_bookings
               where status = 'booked'
                 and date_trunc('week', starts_at at time zone tz) = date_trunc('week', p_now at time zone tz)),
    'needs_marking', (select count(*) from public.onboarding_call_bookings
               where status = 'booked' and starts_at <= p_now),
    'missed_month', (select count(*) from public.onboarding_call_bookings
               where status = 'missed'
                 and date_trunc('month', starts_at at time zone tz) = date_trunc('month', p_now at time zone tz))
  );
end $$;

create or replace function public.onboarding_call_row_json(b public.onboarding_call_bookings, p_tz text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'tenant_id', b.tenant_id,
    'company_name', coalesce(t.company_name, t.slug), 'slug', t.slug,
    'name', b.name, 'email', b.email, 'phone', b.phone,
    'starts_at', b.starts_at, 'ends_at', b.ends_at,
    'host_timezone', p_tz, 'customer_timezone', b.customer_timezone,
    'status', b.status,
    'state', case when b.status = 'booked' and b.starts_at <= now() then 'waiting' else b.status::text end,
    'cancelled_by', b.cancelled_by, 'cancel_reason', b.cancel_reason,
    'booked_via', b.booked_via, 'admin_notes', b.admin_notes, 'created_at', b.created_at)
  from public.tenants t where t.id = b.tenant_id
$$;

create or replace function public.admin_list_onboarding_calls(
  p_view   text default 'upcoming',
  p_from   date default null,
  p_to     date default null,
  p_search text default null,
  p_limit  integer default 25,
  p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tz      text;
  v_q     text := nullif(trim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_rows  jsonb;
  v_total bigint;
begin
  perform public.onboarding_call_require_admin();
  if p_view not in ('upcoming', 'today', 'needs_marking', 'done', 'missed', 'cancelled', 'all') then
    raise exception 'Unknown view %', p_view using errcode = '22023';
  end if;
  select timezone into tz from public.onboarding_call_settings where id;

  with picked as (
    select b from public.onboarding_call_bookings b
      join public.tenants t on t.id = b.tenant_id
     where case p_view
             when 'upcoming'      then b.status = 'booked' and b.starts_at > now()
             when 'today'         then b.status <> 'cancelled' and (b.starts_at at time zone tz)::date = (now() at time zone tz)::date
             when 'needs_marking' then b.status = 'booked' and b.starts_at <= now()
             when 'done'          then b.status = 'completed'
             when 'missed'        then b.status = 'missed'
             when 'cancelled'     then b.status = 'cancelled'
             else true end
       and (p_from is null or (b.starts_at at time zone tz)::date >= p_from)
       and (p_to   is null or (b.starts_at at time zone tz)::date <= p_to)
       and (v_q is null
            or coalesce(t.company_name, '') ilike '%' || v_q || '%'
            or t.slug ilike '%' || v_q || '%'
            or b.name ilike '%' || v_q || '%'
            or b.email ilike '%' || v_q || '%'
            or coalesce(b.phone, '') ilike '%' || v_q || '%')
  ), ordered as (
    select p.b, row_number() over (order by
             case when p_view in ('upcoming', 'today', 'needs_marking') then (p.b).starts_at end asc,
             case when p_view not in ('upcoming', 'today', 'needs_marking') then (p.b).starts_at end desc,
             (p.b).id) as ord
      from picked p
  )
  select (select count(*) from picked),
         coalesce((select jsonb_agg(public.onboarding_call_row_json(o.b, tz) order by o.ord)
                     from ordered o
                    where o.ord > greatest(coalesce(p_offset, 0), 0)
                      and o.ord <= greatest(coalesce(p_offset, 0), 0) + v_limit), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end $$;

create or replace function public.admin_onboarding_call_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b  public.onboarding_call_bookings;
  s  public.onboarding_call_settings;
begin
  perform public.onboarding_call_require_admin();
  select * into b from public.onboarding_call_bookings where id = p_id;
  if b.id is null then raise exception 'No such booking' using errcode = 'P0002'; end if;
  select * into s from public.onboarding_call_settings where id;
  return public.onboarding_call_row_json(b, s.timezone) || jsonb_build_object(
    'notes', b.notes, 'meeting_url', s.meeting_url,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', e.kind, 'actor', e.actor, 'actor_name', u.name,
               'from_starts_at', e.from_starts_at, 'to_starts_at', e.to_starts_at,
               'reason', e.reason, 'created_at', e.created_at) order by e.created_at)
        from public.onboarding_call_history e
        left join public.app_users u on u.id = e.actor_user_id
       where e.booking_id = b.id), '[]'::jsonb));
end $$;

-- ── Spec 06: settings, blocked periods, the clash check ─────────────────────

create or replace function public.admin_save_onboarding_call_settings(
  p_settings  jsonb default '{}'::jsonb,
  p_blocks    jsonb default null,
  p_decisions jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k         text;
  s         public.onboarding_call_settings;
  b         public.onboarding_call_bookings;
  blk       jsonb;
  v_clashes jsonb := '[]'::jsonb;
  v_problem text;
  v_choice  text;
  v_allowed text[] := array['host_name', 'host_title', 'host_email', 'host_photo_url', 'meeting_url',
                            'duration_minutes', 'buffer_minutes', 'timezone', 'weekly_hours', 'blocked_dates',
                            'min_notice_hours', 'max_days_ahead', 'is_accepting'];
  v_decisions jsonb := coalesce(p_decisions, '{}'::jsonb);
begin
  perform public.onboarding_call_require_admin();
  for k in select jsonb_object_keys(coalesce(p_settings, '{}'::jsonb)) loop
    if not k = any (v_allowed) then
      raise exception 'Unknown setting %', k using errcode = '22023';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtext('onboarding_call_booking'));

  begin
    s := public.onboarding_call_settings_row(p_settings);
    -- The settings trigger checks the zone, the windows and the ranges (spec 06.6).
    update public.onboarding_call_settings set
      host_name = s.host_name, host_title = s.host_title, host_email = nullif(trim(coalesce(s.host_email, '')), ''),
      host_photo_url = s.host_photo_url, meeting_url = nullif(trim(coalesce(s.meeting_url, '')), ''),
      duration_minutes = s.duration_minutes, buffer_minutes = s.buffer_minutes, timezone = s.timezone,
      weekly_hours = s.weekly_hours, blocked_dates = s.blocked_dates, min_notice_hours = s.min_notice_hours,
      max_days_ahead = s.max_days_ahead, is_accepting = s.is_accepting
    where id
    returning * into s;

    if p_blocks is not null then
      delete from public.onboarding_call_blocks where true;
      for blk in select value from jsonb_array_elements(p_blocks) loop
        if (blk ->> 'to')::time <= (blk ->> 'from')::time and (blk ->> 'to') <> '24:00' then
          raise exception 'A blocked time must end after it starts' using errcode = '22023';
        end if;
        insert into public.onboarding_call_blocks (starts_at, ends_at, label)
        values (((blk ->> 'date')::date + (blk ->> 'from')::time) at time zone s.timezone,
                ((blk ->> 'date')::date + (blk ->> 'to')::time) at time zone s.timezone,
                nullif(trim(coalesce(blk ->> 'label', '')), ''));
      end loop;
    end if;

    -- Spec 06.7: live future calls the new settings no longer allow.
    for b in select * from public.onboarding_call_bookings where status = 'booked' and starts_at > now() order by starts_at loop
      v_problem := case
        when (b.starts_at at time zone s.timezone)::date = any (s.blocked_dates) then 'day_off'
        when public.onboarding_call_fit(s, b.starts_at, b.ends_at, false) is not null then 'outside_hours'
        when exists (select 1 from public.onboarding_call_blocks x where x.starts_at < b.ends_at and x.ends_at > b.starts_at) then 'blocked'
        else null end;
      if v_problem is not null then
        v_clashes := v_clashes || jsonb_build_object(
          'id', b.id, 'tenant_id', b.tenant_id, 'name', b.name, 'starts_at', b.starts_at, 'problem', v_problem,
          'customer_timezone', b.customer_timezone,
          'company_name', (select coalesce(company_name, slug) from public.tenants where id = b.tenant_id));
      end if;
    end loop;

    if jsonb_array_length(v_clashes) > 0 then
      if v_decisions = '{}'::jsonb then
        raise exception 'clashes' using errcode = 'P0010';
      end if;
      if (select count(*) from jsonb_object_keys(v_decisions)) <> jsonb_array_length(v_clashes)
         or exists (select 1 from jsonb_array_elements(v_clashes) c
                     where coalesce(v_decisions ->> (c ->> 'id'), '') not in ('keep', 'cancel')) then
        raise exception 'Choose what to do with each booked call' using errcode = '22023';
      end if;
      for b in select x.* from public.onboarding_call_bookings x
                 join jsonb_array_elements(v_clashes) c on (c ->> 'id')::uuid = x.id loop
        v_choice := v_decisions ->> b.id::text;
        if v_choice = 'cancel' then
          perform public.onboarding_call_cancel(b, 'admin', 'Bryan is no longer available at this time.');
        end if;
      end loop;
    elsif v_decisions <> '{}'::jsonb then
      raise exception 'Choose what to do with each booked call' using errcode = '22023';
    end if;
  exception when sqlstate 'P0010' then
    return jsonb_build_object('saved', false, 'clashes', v_clashes);
  end;

  return jsonb_build_object('saved', true, 'clashes', v_clashes);
end $$;

-- ── Spec 08: reminders and the mailer's claim ───────────────────────────────

create or replace function public.onboarding_call_due_reminders(p_now timestamptz default now())
returns table (booking_id uuid, kind public.onboarding_call_email_kind, starts_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, 'reminder_day'::public.onboarding_call_email_kind, b.starts_at
    from public.onboarding_call_bookings b
   where b.status = 'booked'
     and p_now >= b.starts_at - interval '24 hours'
     and p_now <  b.starts_at - interval '1 hour'
     and coalesce(b.rescheduled_at, b.created_at) <= b.starts_at - interval '24 hours'
  union all
  select b.id, 'reminder_hour'::public.onboarding_call_email_kind, b.starts_at
    from public.onboarding_call_bookings b
   where b.status = 'booked'
     and p_now >= b.starts_at - interval '1 hour'
     and p_now <  b.starts_at
$$;

create or replace function public.onboarding_call_queue_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in select * from public.onboarding_call_due_reminders(p_now) loop
    perform public.onboarding_call_queue_email(r.booking_id, r.kind);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.onboarding_call_claim_emails(p_limit integer default 20)
returns setof public.onboarding_call_emails
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.onboarding_call_emails e
     set status = 'sending', claimed_at = now()
   where e.id in (
     select x.id from public.onboarding_call_emails x
      where x.status = 'pending'
         or (x.status = 'sending' and x.claimed_at < now() - interval '10 minutes')
      order by x.created_at
      limit greatest(p_limit, 1)
      for update skip locked)
  returning e.*;
end $$;

-- ── Who may call what ──────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'onboarding_call_message(text)', 'onboarding_call_refuse(text)', 'onboarding_call_minutes(text)',
    'onboarding_call_fit(public.onboarding_call_settings, timestamptz, timestamptz, boolean)',
    'onboarding_call_slot_problem(public.onboarding_call_settings, timestamptz, timestamptz, boolean, uuid)',
    'onboarding_call_free_slots(public.onboarding_call_settings, timestamptz, boolean, uuid)',
    'onboarding_call_settings_row(jsonb)', 'onboarding_call_app_user()', 'onboarding_call_is_owner()',
    'onboarding_call_log(uuid, uuid, public.onboarding_call_event_kind, text, timestamptz, timestamptz, text)',
    'onboarding_call_queue_email(uuid, public.onboarding_call_email_kind, jsonb)',
    'onboarding_call_sync_journey(uuid, text)', 'onboarding_call_on_offer(uuid)',
    'onboarding_call_check_details(text, text, text, text)',
    'onboarding_call_cancel(public.onboarding_call_bookings, text, text)',
    'onboarding_call_require_admin()', 'onboarding_call_row_json(public.onboarding_call_bookings, text)',
    'onboarding_call_due_reminders(timestamptz)', 'onboarding_call_queue_reminders(timestamptz)',
    'onboarding_call_claim_emails(integer)', 'onboarding_call_bookings_check()']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;

  foreach f in array array[
    'get_onboarding_call_calendar()',
    'book_onboarding_call(timestamptz, text, text, text, text, text)',
    'cancel_my_onboarding_call(text)', 'get_my_onboarding_call()',
    'preview_onboarding_call_slots(jsonb, timestamptz, boolean)',
    'check_onboarding_call_slot(timestamptz, jsonb, timestamptz, boolean)',
    'admin_set_onboarding_call_booking(uuid, public.onboarding_call_booking_status, text)',
    'admin_note_onboarding_call(uuid, text)', 'admin_cancel_onboarding_call(uuid, text)',
    'admin_move_onboarding_call(uuid, timestamptz)',
    'admin_book_onboarding_call(uuid, timestamptz, text, text, text, text, text)',
    'admin_onboarding_call_free_slots(uuid)', 'admin_onboarding_call_counts(timestamptz)',
    'admin_list_onboarding_calls(text, date, date, text, integer, integer)',
    'admin_onboarding_call_detail(uuid)',
    'admin_save_onboarding_call_settings(jsonb, jsonb, jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

commit;
