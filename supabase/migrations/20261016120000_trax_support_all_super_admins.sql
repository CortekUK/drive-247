-- Every active super admin can open the platform Support inbox.
--
-- The admin path used to require a row in trax_support_agents as well, and only
-- one super admin had one, so every other super admin was refused. The rule is
-- now: an active app_users row for this auth user with is_super_admin = true.
-- trax_support_agents still governs the TRAX-side agent capabilities
-- (trax_support_guard p_agent / can_manage_policy); those are unchanged.
--
-- Body-only change: same signature, same callers (trax_messaging_request etc).
create or replace function public.trax_messaging_guard(p_user uuid, p_staff uuid, p_tenant uuid, p_admin boolean)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare member public.app_users%rowtype;
begin
  select * into member from public.app_users where id=p_staff and auth_user_id=p_user and is_active for share;
  if member.id is null then raise exception 'support_access_denied'; end if;
  if p_admin then
    if not coalesce(member.is_super_admin,false) then raise exception 'support_access_denied';end if;
  elsif (not coalesce(member.is_super_admin,false) and member.tenant_id is distinct from p_tenant)
     or not exists(select 1 from public.tenants where id=p_tenant and status='active')
     or (not coalesce(member.is_super_admin,false) and member.role not in ('head_admin','admin','manager','ops','viewer')) then
    raise exception 'support_access_denied';
  end if;
end $function$;
