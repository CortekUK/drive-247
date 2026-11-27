-- feat-001 spec 09 · The signups list after signup became 3 steps
-- (About you → Your business → Card). The email code and the password moved
-- into the portal (spec 03), so signup-lead's STEP_ORDER is now
-- details 1, business 2, card 3, done 4.
--
-- 1. Lead rows saved under the old 5-step order keep their last_step (the
--    admin list labels email_code / password as "(old signup)"), but their
--    last_step_order is put on the new scale, so a new save compares fairly:
--    email_code and password were both past the business page and before the
--    card, which is 2 on the new scale.
-- 2. admin_signups() gains email_confirmed and password_set: whether the
--    person has finished the portal's verify window. Both are read from the
--    flags the signup sets (d247_signup_email_pending /
--    d247_signup_password_pending); an account without them (older signups,
--    Google) counts as done. Null for a lead (no account).
--    Its columns change, so it is dropped and made again.

update public.signup_leads
   set last_step_order = case last_step
         when 'details'    then 1
         when 'business'   then 2
         when 'email_code' then 2
         when 'password'   then 2
         when 'card'       then 3
         when 'done'       then 4
         else last_step_order
       end,
       updated_at = updated_at
 where last_step in ('details', 'business', 'email_code', 'password', 'card', 'done');

comment on column public.signup_leads.last_step is
  'details → business → card → done (3-step signup, feat-001); only moves forward. Older rows may hold email_code or password from the 5-step form.';

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
  lead_id uuid,
  email_confirmed boolean,
  password_set boolean
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
    l.id,
    not coalesce((u.raw_app_meta_data ->> 'd247_signup_email_pending')::boolean, false),
    not coalesce((u.raw_app_meta_data ->> 'd247_signup_password_pending')::boolean, false)
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
    l.id,
    null::boolean,
    null::boolean
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
