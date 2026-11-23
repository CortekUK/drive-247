-- =============================================================================
-- Bryan's own booking calendar for the free onboarding call (23 Nov 2026).
--
-- Replaces the GoHighLevel (LeadConnector) widget the portal embedded. Bryan
-- sets his hours in the super admin dashboard (Call Calendar), and a new
-- company books a slot from the portal's own calendar.
--
--   onboarding_call_settings   one row: Bryan's hours, call length, time zone
--   onboarding_call_bookings   one row per booking
--
-- A booking also writes the per-company row the rest of the journey already
-- reads (tenant_onboarding_calls: call_booked_at, call_scheduled_for), so the
-- "book your call" emails stop and the Onboarding calls tracker shows it, the
-- same as a GHL booking did. `call_booked_via` = 'calendar'.
--
-- Additive only: two new tables, one enum, five functions. Nothing existing
-- is altered.
-- =============================================================================

-- ── Settings: one row ───────────────────────────────────────────────────────

create table if not exists public.onboarding_call_settings (
  id               boolean primary key default true check (id),
  host_name        text    not null default 'Bryan Diaz',
  host_title       text    not null default 'Onboarding specialist',
  host_email       text,
  host_photo_url   text    not null default '/team/bryan.jpg',
  -- Zoom / Google Meet link, shown to the company once they have booked.
  meeting_url      text,
  duration_minutes integer not null default 30  check (duration_minutes between 10 and 180),
  -- Kept free before and after every booked call.
  buffer_minutes   integer not null default 0   check (buffer_minutes between 0 and 120),
  -- Bryan's time zone: his hours below are in it.
  timezone         text    not null default 'America/New_York',
  -- { "<JS day 0=Sun..6=Sat>": [["09:00","17:00"], ...] }. A missing day is a day off.
  weekly_hours     jsonb   not null default
    '{"1":[["09:00","17:00"]],"2":[["09:00","17:00"]],"3":[["09:00","17:00"]],"4":[["09:00","17:00"]],"5":[["09:00","17:00"]]}'::jsonb,
  -- Whole days off (holidays, leave), in Bryan's time zone.
  blocked_dates    date[]  not null default '{}',
  min_notice_hours integer not null default 12  check (min_notice_hours between 0 and 336),
  max_days_ahead   integer not null default 30  check (max_days_ahead between 1 and 180),
  is_accepting     boolean not null default true,
  updated_at       timestamptz not null default now()
);

insert into public.onboarding_call_settings (id) values (true) on conflict (id) do nothing;

-- A bad time zone or a malformed window would break every slot, so neither
-- gets in.
create or replace function public.onboarding_call_settings_check()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  k text;
  v jsonb;
  w jsonb;
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone %', new.timezone using errcode = '22023';
  end if;
  if jsonb_typeof(new.weekly_hours) <> 'object' then
    raise exception 'weekly_hours must be an object' using errcode = '22023';
  end if;
  for k, v in select key, value from jsonb_each(new.weekly_hours) loop
    if k not in ('0', '1', '2', '3', '4', '5', '6') then
      raise exception 'Unknown day %', k using errcode = '22023';
    end if;
    if jsonb_typeof(v) <> 'array' then
      raise exception 'Day % must be a list of windows', k using errcode = '22023';
    end if;
    for w in select value from jsonb_array_elements(v) loop
      if jsonb_typeof(w) <> 'array' or jsonb_array_length(w) <> 2 then
        raise exception 'Each window is [start, end]' using errcode = '22023';
      end if;
      if (w ->> 0)::time >= (w ->> 1)::time then
        raise exception 'A window must end after it starts (% to %)', w ->> 0, w ->> 1 using errcode = '22023';
      end if;
    end loop;
  end loop;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists onboarding_call_settings_check on public.onboarding_call_settings;
create trigger onboarding_call_settings_check
  before insert or update on public.onboarding_call_settings
  for each row execute function public.onboarding_call_settings_check();

alter table public.onboarding_call_settings enable row level security;

drop policy if exists "Super admins read call settings" on public.onboarding_call_settings;
create policy "Super admins read call settings" on public.onboarding_call_settings
  for select using (public.is_super_admin());

drop policy if exists "Super admins update call settings" on public.onboarding_call_settings;
create policy "Super admins update call settings" on public.onboarding_call_settings
  for update using (public.is_super_admin()) with check (public.is_super_admin());

-- ── Bookings ────────────────────────────────────────────────────────────────

do $$ begin
  create type public.onboarding_call_booking_status as enum ('booked', 'completed', 'missed', 'cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists public.onboarding_call_bookings (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  booked_by    uuid references public.app_users(id) on delete set null,
  name         text not null check (length(trim(name)) between 1 and 120),
  email        text not null check (position('@' in email) > 1 and length(email) <= 254),
  phone        text check (phone is null or length(phone) <= 40),
  notes        text check (notes is null or length(notes) <= 1000),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       public.onboarding_call_booking_status not null default 'booked',
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by is null or cancelled_by in ('operator', 'admin')),
  admin_notes  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- One host: a start time holds at most one live booking, and a company holds
-- at most one live booking (booking again is a reschedule).
create unique index if not exists onboarding_call_bookings_one_per_slot
  on public.onboarding_call_bookings (starts_at) where status = 'booked';
create unique index if not exists onboarding_call_bookings_one_per_tenant
  on public.onboarding_call_bookings (tenant_id) where status = 'booked';
create index if not exists onboarding_call_bookings_starts_at
  on public.onboarding_call_bookings (starts_at);

drop trigger if exists onboarding_call_bookings_updated_at on public.onboarding_call_bookings;
create trigger onboarding_call_bookings_updated_at
  before update on public.onboarding_call_bookings
  for each row execute function public.set_updated_at();

alter table public.onboarding_call_bookings enable row level security;

-- Reads for Bryan. Every write goes through the functions below.
drop policy if exists "Super admins read call bookings" on public.onboarding_call_bookings;
create policy "Super admins read call bookings" on public.onboarding_call_bookings
  for select using (public.is_super_admin());

-- ── The portal: what the calendar needs ────────────────────────────────────
--
-- Bryan's settings, the busy times (start and end only, no names), and the
-- caller's own live booking. A super admin with no company (looking at the
-- canary) gets the calendar with no booking of their own.

create or replace function public.get_onboarding_call_calendar()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  s        public.onboarding_call_settings%rowtype;
  v_mine   jsonb;
begin
  if v_tenant is null and not public.is_super_admin() then
    raise exception 'Sign in to book a call' using errcode = '42501';
  end if;

  select * into s from public.onboarding_call_settings where id;

  if v_tenant is not null then
    select jsonb_build_object(
             'id', b.id, 'name', b.name, 'email', b.email, 'phone', b.phone,
             'notes', b.notes, 'starts_at', b.starts_at, 'ends_at', b.ends_at)
      into v_mine
      from public.onboarding_call_bookings b
     where b.tenant_id = v_tenant and b.status = 'booked'
     order by b.starts_at
     limit 1;
  end if;

  return jsonb_build_object(
    'host_name',        s.host_name,
    'host_title',       s.host_title,
    'host_photo_url',   s.host_photo_url,
    'duration_minutes', s.duration_minutes,
    'buffer_minutes',   s.buffer_minutes,
    'timezone',         s.timezone,
    'weekly_hours',     s.weekly_hours,
    'blocked_dates',    to_jsonb(s.blocked_dates),
    'min_notice_hours', s.min_notice_hours,
    'max_days_ahead',   s.max_days_ahead,
    'is_accepting',     s.is_accepting,
    -- The meeting link only once they have a booking.
    'meeting_url',      case when v_mine is not null then s.meeting_url end,
    'busy', coalesce((
      select jsonb_agg(jsonb_build_array(b.starts_at, b.ends_at) order by b.starts_at)
        from public.onboarding_call_bookings b
       where b.status = 'booked'
         and b.ends_at > now()
         and b.starts_at < now() + make_interval(days => s.max_days_ahead + 1)
         and (v_tenant is null or b.tenant_id <> v_tenant)
    ), '[]'::jsonb),
    'mine', v_mine
  );
end $$;

-- ── The portal: book (or move) the call ────────────────────────────────────
--
-- Checks the slot against Bryan's settings on the server, whatever the page
-- sent: notice, how far ahead, day off, inside his hours, clear of other
-- calls (with the buffer). Bookings are taken one at a time (an advisory
-- lock), so two companies can never land on one slot. Booking again while a
-- call is booked moves it.

create or replace function public.book_onboarding_call(
  p_starts_at timestamptz,
  p_name      text,
  p_email     text,
  p_phone     text default null,
  p_notes     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant    uuid := public.get_user_tenant_id();
  s           public.onboarding_call_settings%rowtype;
  v_end       timestamptz;
  v_local     timestamp;
  v_local_end timestamp;
  v_fits      boolean := false;
  w           jsonb;
  v_user      uuid;
  v_id        uuid;
begin
  if v_tenant is null then
    raise exception 'There is no company on this login to book for' using errcode = '42501';
  end if;
  if not public.onboarding_call_eligible(v_tenant) then
    raise exception 'The onboarding call is not available for this account' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('onboarding_call_booking'));

  select * into s from public.onboarding_call_settings where id;
  if not s.is_accepting then
    raise exception 'Bryan is not taking new calls right now' using errcode = 'P0001';
  end if;
  if p_starts_at < now() + make_interval(hours => s.min_notice_hours) then
    raise exception 'That time is too soon. Please pick a later one.' using errcode = 'P0001';
  end if;
  if p_starts_at > now() + make_interval(days => s.max_days_ahead) then
    raise exception 'That time is too far ahead. Please pick an earlier one.' using errcode = 'P0001';
  end if;

  v_end       := p_starts_at + make_interval(mins => s.duration_minutes);
  v_local     := p_starts_at at time zone s.timezone;
  v_local_end := v_end at time zone s.timezone;

  if v_local::date = any (s.blocked_dates) or v_local_end::date <> v_local::date then
    raise exception 'Bryan is not available then. Please pick another time.' using errcode = 'P0001';
  end if;
  for w in
    select value from jsonb_array_elements(coalesce(s.weekly_hours -> extract(dow from v_local)::int::text, '[]'::jsonb))
  loop
    if v_local::time >= (w ->> 0)::time and v_local_end::time <= (w ->> 1)::time then
      v_fits := true;
      exit;
    end if;
  end loop;
  if not v_fits then
    raise exception 'Bryan is not available then. Please pick another time.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.onboarding_call_bookings b
     where b.status = 'booked'
       and b.tenant_id <> v_tenant
       and b.starts_at < v_end + make_interval(mins => s.buffer_minutes)
       and b.ends_at + make_interval(mins => s.buffer_minutes) > p_starts_at
  ) then
    raise exception 'Someone has just taken that time. Please pick another.' using errcode = 'P0001';
  end if;

  -- Booking again moves the call: the old one is cancelled first.
  update public.onboarding_call_bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'operator'
   where tenant_id = v_tenant and status = 'booked';

  select id into v_user from public.app_users where auth_user_id = auth.uid() limit 1;

  insert into public.onboarding_call_bookings (tenant_id, booked_by, name, email, phone, notes, starts_at, ends_at)
  values (v_tenant, v_user, trim(p_name), lower(trim(p_email)),
          nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_notes, '')), ''),
          p_starts_at, v_end)
  returning id into v_id;

  -- The journey row the rest of the app reads.
  insert into public.tenant_onboarding_calls (tenant_id) values (v_tenant)
  on conflict (tenant_id) do nothing;
  update public.tenant_onboarding_calls
     set call_booked_at     = now(),
         call_booked_via    = 'calendar',
         call_scheduled_for = p_starts_at,
         call_cancelled_at  = null,
         call_missed_at     = null
   where tenant_id = v_tenant;

  return jsonb_build_object(
    'id', v_id, 'starts_at', p_starts_at, 'ends_at', v_end,
    'meeting_url', s.meeting_url, 'host_name', s.host_name, 'timezone', s.timezone
  );
end $$;

-- ── The portal: cancel the call ─────────────────────────────────────────────

create or replace function public.cancel_my_onboarding_call()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
begin
  if v_tenant is null then
    raise exception 'There is no company on this login' using errcode = '42501';
  end if;

  update public.onboarding_call_bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'operator'
   where tenant_id = v_tenant and status = 'booked';

  update public.tenant_onboarding_calls
     set call_booked_at     = null,
         call_booked_via    = null,
         call_scheduled_for = null,
         call_cancelled_at  = now()
   where tenant_id = v_tenant;
end $$;

-- ── Bryan: mark a call done, missed or cancelled ───────────────────────────

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
  b public.onboarding_call_bookings%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;

  update public.onboarding_call_bookings
     set status       = p_status,
         cancelled_at = case when p_status = 'cancelled' then coalesce(cancelled_at, now()) else null end,
         cancelled_by = case when p_status = 'cancelled' then coalesce(cancelled_by, 'admin') else null end,
         admin_notes  = coalesce(p_admin_notes, admin_notes)
   where id = p_id
  returning * into b;

  if b.id is null then
    raise exception 'No such booking' using errcode = 'P0002';
  end if;

  insert into public.tenant_onboarding_calls (tenant_id) values (b.tenant_id)
  on conflict (tenant_id) do nothing;

  update public.tenant_onboarding_calls
     set call_completed_at  = case when p_status = 'completed' then coalesce(call_completed_at, now()) else call_completed_at end,
         call_missed_at     = case when p_status = 'missed' then now() else call_missed_at end,
         call_cancelled_at  = case when p_status = 'cancelled' then now() else call_cancelled_at end,
         call_booked_at     = case when p_status = 'cancelled' then null
                                   when p_status = 'booked' then coalesce(call_booked_at, now())
                                   else call_booked_at end,
         call_booked_via    = case when p_status = 'cancelled' then null
                                   when p_status = 'booked' then 'calendar'
                                   else call_booked_via end,
         call_scheduled_for = case when p_status = 'cancelled' then null
                                   when p_status = 'booked' then b.starts_at
                                   else call_scheduled_for end
   where tenant_id = b.tenant_id;
end $$;

-- ── Who may call what ──────────────────────────────────────────────────────

revoke all on function public.get_onboarding_call_calendar() from public, anon;
revoke all on function public.book_onboarding_call(timestamptz, text, text, text, text) from public, anon;
revoke all on function public.cancel_my_onboarding_call() from public, anon;
revoke all on function public.admin_set_onboarding_call_booking(uuid, public.onboarding_call_booking_status, text) from public, anon;

grant execute on function public.get_onboarding_call_calendar() to authenticated;
grant execute on function public.book_onboarding_call(timestamptz, text, text, text, text) to authenticated;
grant execute on function public.cancel_my_onboarding_call() to authenticated;
grant execute on function public.admin_set_onboarding_call_booking(uuid, public.onboarding_call_booking_status, text) to authenticated;

grant select, update on public.onboarding_call_settings to authenticated;
grant select on public.onboarding_call_bookings to authenticated;
