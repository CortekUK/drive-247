-- Super Admin → a company's page → Force logout: see every signed-in session
-- of that company (its portal staff and its booking customers) and sign out
-- the chosen ones, leaving the rest.
--
--   admin_list_tenant_sessions(tenant)            who is signed in, where, on what
--   admin_revoke_tenant_sessions(tenant, ids[])   end those sessions only
--
-- Both are SECURITY DEFINER because auth.sessions is not readable through the
-- API, and both refuse anyone who is not a super admin (is_super_admin()).
-- Revoking only touches sessions that belong to the given company's people, so
-- a session id from elsewhere is ignored rather than ended.
--
-- Additive (V2_PLAN §4): two new functions nothing else calls.

create or replace function public.admin_list_tenant_sessions(p_tenant_id uuid)
returns table (
  session_id   uuid,
  user_id      uuid,
  kind         text,
  name         text,
  email        text,
  role         text,
  signed_in_at timestamptz,
  last_active  timestamptz,
  user_agent   text,
  ip           text
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super admin only' using errcode = '42501';
  end if;

  return query
  with people as (
    select a.auth_user_id as uid, 'staff'::text as kind, a.name, a.email, a.role::text as role
    from public.app_users a
    where a.tenant_id = p_tenant_id and a.auth_user_id is not null
    union all
    select cu.auth_user_id, 'customer', c.name, c.email, null
    from public.customer_users cu
    left join public.customers c on c.id = cu.customer_id
    where cu.tenant_id = p_tenant_id and cu.auth_user_id is not null
  )
  select s.id, s.user_id, p.kind, p.name, p.email, p.role,
         s.created_at,
         greatest(s.updated_at, s.refreshed_at at time zone 'utc'),
         s.user_agent, host(s.ip)
  from auth.sessions s
  join people p on p.uid = s.user_id
  where s.not_after is null or s.not_after > now()
  order by greatest(s.updated_at, s.refreshed_at at time zone 'utc') desc nulls last;
end;
$$;

create or replace function public.admin_revoke_tenant_sessions(p_tenant_id uuid, p_session_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_deleted integer;
begin
  if not public.is_super_admin() then
    raise exception 'Super admin only' using errcode = '42501';
  end if;

  with people as (
    select a.auth_user_id as uid from public.app_users a
    where a.tenant_id = p_tenant_id and a.auth_user_id is not null and not coalesce(a.is_super_admin, false)
    union
    select cu.auth_user_id from public.customer_users cu
    where cu.tenant_id = p_tenant_id and cu.auth_user_id is not null
  ),
  gone as (
    delete from auth.sessions s
    using people p
    where s.user_id = p.uid and s.id = any(p_session_ids)
    returning s.id
  )
  select count(*) into v_deleted from gone;

  delete from auth.refresh_tokens where session_id = any(p_session_ids);
  return v_deleted;
end;
$$;

revoke all on function public.admin_list_tenant_sessions(uuid) from public, anon;
revoke all on function public.admin_revoke_tenant_sessions(uuid, uuid[]) from public, anon;
grant execute on function public.admin_list_tenant_sessions(uuid) to authenticated;
grant execute on function public.admin_revoke_tenant_sessions(uuid, uuid[]) to authenticated;
