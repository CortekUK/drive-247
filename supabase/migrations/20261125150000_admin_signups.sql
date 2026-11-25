-- Super admin → Customer Management → Signups: every self-serve signup and
-- its details, finished or not (Bryan, 2026-11-25: a lead who stopped at the
-- card step had a phone number on record but nowhere in admin showed it).
--
-- One row per auth user that went through the drive-247.com signup
-- (raw_app_meta_data.d247_signup). The answers come from signup_attribution
-- (phone, city and state, fleet size, how they heard), the rest from the
-- signup's own metadata, and the company and its subscription once the portal
-- is built. Read the same way as admin_onboarding_calls: SECURITY DEFINER,
-- super admins only, nothing written.

create or replace function public.admin_signups()
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
  exit_offer_seen_at timestamptz
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
  select
    u.id,
    u.email::text,
    nullif(trim(coalesce(m->>'fullName', u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), ''),
    coalesce(nullif(trim(sa.phone), ''), nullif(trim(m->>'phone'), ''), nullif(trim(t.contact_phone), ''), nullif(trim(t.phone), '')),
    coalesce(nullif(trim(sa.city_state), ''), nullif(trim(m->>'cityState'), '')),
    coalesce(nullif(trim(sa.fleet_size), ''), nullif(trim(m->>'fleetSize'), ''), t.fleet_size),
    coalesce(sa.heard_about, m->>'heardAbout'),
    sa.heard_about_other,
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
    sa.exit_offer_seen_at
  from auth.users u
  cross join lateral (select u.raw_app_meta_data->'d247_signup' as m) j
  left join lateral (
    select a.phone, a.city_state, a.fleet_size, a.heard_about::text as heard_about, a.heard_about_other, a.exit_offer_seen_at
      from signup_attribution a
     where a.auth_user_id = u.id
     order by a.updated_at desc nulls last
     limit 1
  ) sa on true
  left join tenants t on t.id = nullif(m->>'tenantId', '')::uuid
  left join lateral (
    select ts.status, ts.trial_end from tenant_subscriptions ts
     where ts.tenant_id = t.id
     order by ts.created_at desc
     limit 1
  ) s on true
  where m is not null and jsonb_typeof(m) = 'object'
  order by u.created_at desc;
end;
$function$;

revoke all on function public.admin_signups() from public, anon;
grant execute on function public.admin_signups() to authenticated;
