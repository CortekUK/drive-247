-- Signup leads: save what someone typed as soon as the first signup page is
-- done, before any account exists (Neema, 2026-11-25).
--
-- Since the 5-step form went live on 22 Nov, people who stop before the
-- business page leave no record at all: the account and the Stripe customer
-- are only created once the business page is submitted. Four people who typed
-- their name, email and phone were lost that way in 3 days. Each visitor's
-- browser now holds a random lead token; `signup-lead` writes this row with
-- the token's SHA-256 (never the token itself) and moves `last_step` forward as
-- they go. Bryan sees them in admin → Retention → Signups as "Started signup,
-- not finished".
--
-- Service role only: RLS on and no policies. Admin reads through
-- admin_signups() below, the browser only through signup-lead.

create table if not exists public.signup_leads (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email text,
  full_name text,
  phone text,
  fleet_size text,
  heard_about text,
  heard_about_other text,
  city_state text,
  plan_id text,
  -- details → business → email_code → password → card → done; only moves forward.
  last_step text not null default 'details',
  last_step_order integer not null default 1,
  in_app_browser text,
  ip_address text,
  user_agent text,
  auth_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists signup_leads_email_idx on public.signup_leads (lower(email));
create index if not exists signup_leads_created_idx on public.signup_leads (created_at desc);

alter table public.signup_leads enable row level security;
revoke all on public.signup_leads from anon, authenticated, public;

comment on table public.signup_leads is
  'drive-247.com signup answers saved from the first page on, before an account exists. Written only by the signup-lead edge function (service role); read by admin_signups().';

-- admin_signups() gains the leads. Its columns change (lead_step), so it is
-- dropped and made again rather than replaced.
drop function if exists public.admin_signups();

create function public.admin_signups()
returns table (
  auth_user_id uuid,
  email text,
  full_name text,
  phone text,
  city_state text,
  fleet_size text,
  heard_about text,
  heard_about_other text,
  plan_id text,
  signup_status text,
  company_name text,
  tenant_id uuid,
  tenant_slug text,
  subscription_status text,
  trial_end timestamptz,
  signed_up_at timestamptz,
  email_verified_at timestamptz,
  paid_at timestamptz,
  last_sign_in_at timestamptz,
  exit_offer_seen_at timestamptz,
  lead_step text,
  lead_id uuid
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;

  return query
  -- Everyone with an account: answers from signup_attribution, falling back
  -- to the lead row they typed before the account existed.
  select
    u.id,
    u.email::text,
    nullif(trim(coalesce(m->>'fullName', u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', l.full_name, '')), ''),
    coalesce(nullif(trim(sa.phone), ''), nullif(trim(m->>'phone'), ''), nullif(trim(l.phone), ''), nullif(trim(t.contact_phone), ''), nullif(trim(t.phone), '')),
    coalesce(nullif(trim(sa.city_state), ''), nullif(trim(m->>'cityState'), ''), nullif(trim(l.city_state), '')),
    coalesce(nullif(trim(sa.fleet_size), ''), nullif(trim(m->>'fleetSize'), ''), t.fleet_size, l.fleet_size),
    coalesce(sa.heard_about, m->>'heardAbout', l.heard_about),
    coalesce(sa.heard_about_other, l.heard_about_other),
    m->>'planId',
    m->>'status',
    coalesce(t.company_name, nullif(trim(m->'business'->>'companyName'), '')),
    t.id,
    t.slug,
    s.status::text,
    s.trial_end,
    u.created_at,
    nullif(m->>'emailVerifiedAt', '')::timestamptz,
    nullif(m->>'paidAt', '')::timestamptz,
    u.last_sign_in_at,
    sa.exit_offer_seen_at,
    l.last_step,
    l.id
  from auth.users u
  cross join lateral (select u.raw_app_meta_data->'d247_signup' as m) j
  left join lateral (
    select a.phone, a.city_state, a.fleet_size, a.heard_about::text as heard_about, a.heard_about_other, a.exit_offer_seen_at
      from signup_attribution a
     where a.auth_user_id = u.id
     order by a.updated_at desc nulls last
     limit 1
  ) sa on true
  left join lateral (
    select sl.* from signup_leads sl
     where sl.auth_user_id = u.id or lower(sl.email) = lower(u.email)
     order by sl.updated_at desc
     limit 1
  ) l on true
  left join tenants t on t.id = nullif(m->>'tenantId', '')::uuid
  left join lateral (
    select ts.status, ts.trial_end from tenant_subscriptions ts
     where ts.tenant_id = t.id
     order by ts.created_at desc
     limit 1
  ) s on true
  where m is not null and jsonb_typeof(m) = 'object'

  union all

  -- Leads with no account yet: they stopped before the business page was done.
  -- One row per email (their latest), so a person who restarted shows once.
  select
    null::uuid,
    l.email,
    l.full_name,
    l.phone,
    l.city_state,
    l.fleet_size,
    l.heard_about,
    l.heard_about_other,
    l.plan_id,
    'lead'::text,
    null::text,
    null::uuid,
    null::text,
    null::text,
    null::timestamptz,
    l.created_at,
    null::timestamptz,
    null::timestamptz,
    null::timestamptz,
    null::timestamptz,
    l.last_step,
    l.id
  from (
    select distinct on (lower(coalesce(sl.email, sl.id::text))) sl.*
      from signup_leads sl
     where sl.auth_user_id is null
     order by lower(coalesce(sl.email, sl.id::text)), sl.updated_at desc
  ) l
  where not exists (
    select 1 from auth.users u2
     where lower(u2.email) = lower(l.email)
       and u2.raw_app_meta_data ? 'd247_signup'
  )

  order by 16 desc;
end;
$function$;

revoke all on function public.admin_signups() from public, anon;
grant execute on function public.admin_signups() to authenticated;
