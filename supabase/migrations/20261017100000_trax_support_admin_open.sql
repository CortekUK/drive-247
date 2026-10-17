-- Platform support opens a ticket TO a tenant user (the super admin's "New ticket").
--
-- Until now only a requester could open a ticket (`trax_messaging_request('create')`
-- refuses p_admin). This adds two NEW functions beside it — the existing ones keep
-- their bodies and signatures:
--
--   trax_support_admin_targets  who a ticket can be opened for: active companies,
--                               then one company's active staff
--   trax_support_admin_open     the ticket, filed under the chosen requester, with
--                               support's message as its first message
--
-- The ticket belongs to the chosen tenant user exactly as if they had raised it, so
-- it appears in their own Support inbox with no change to the list/detail queries.
-- No new-ticket email job is queued: that job tells platform support a tenant wrote
-- in, and here platform support is the author.
--
-- service_role only, like every trax_messaging_* function; the edge function
-- authenticates the super admin and passes p_user/p_staff, and the guard rechecks.

create or replace function public.trax_support_admin_targets(p_user uuid, p_staff uuid, p_tenant uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform public.trax_messaging_guard(p_user,p_staff,null,true);
  if p_tenant is null then
    return jsonb_build_object('tenants',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by lower(x.name)),'[]') from (
      select n.id,coalesce(nullif(btrim(n.company_name),''),n.slug,'Rental company') as name
      from public.tenants n where n.status='active') x));
  end if;
  return jsonb_build_object('people',(select coalesce(jsonb_agg(jsonb_build_object('id',x.auth_user_id,'name',x.name,'email',x.email,'role',x.role) order by lower(x.name)),'[]') from (
    select u.auth_user_id,coalesce(nullif(btrim(u.name),''),u.email,'Team member') as name,u.email,u.role
    from public.app_users u
    where u.tenant_id=p_tenant and u.is_active and u.auth_user_id is not null
      and not coalesce(u.is_super_admin,false)
      and u.role in ('head_admin','admin','manager','ops','viewer')) x));
end $$;

create or replace function public.trax_support_admin_open(p_user uuid, p_staff uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare ticket public.trax_support_tickets%rowtype; ident uuid; target_tenant uuid; target_user uuid; body text; subject text;
begin
  perform public.trax_messaging_guard(p_user,p_staff,null,true);
  ident=(p_data->>'nonce')::uuid; target_tenant=(p_data->>'tenant')::uuid; target_user=(p_data->>'requester')::uuid;
  body=btrim(coalesce(p_data->>'body','')); subject=btrim(coalesce(p_data->>'subject',''));
  if ident is null or target_tenant is null or target_user is null
     or length(body) not between 1 and 4000 or length(subject) not between 1 and 240 then
    raise exception 'invalid_support_message';
  end if;
  -- The requester must be an active member of that active company, the same people
  -- trax_messaging_guard lets open the tenant side of a ticket.
  if not exists(select 1 from public.tenants where id=target_tenant and status='active')
     or not exists(select 1 from public.app_users u where u.auth_user_id=target_user and u.tenant_id=target_tenant and u.is_active
       and not coalesce(u.is_super_admin,false) and u.role in ('head_admin','admin','manager','ops','viewer')) then
    raise exception 'invalid_support_target';
  end if;
  -- A retried submission (same nonce) returns the ticket it already made.
  perform pg_advisory_xact_lock(hashtextextended(ident::text,0));
  select * into ticket from public.trax_support_tickets where issue_id=ident;
  if ticket.id is not null then
    if ticket.tenant_id<>target_tenant or ticket.user_id<>target_user then raise exception 'support_access_denied';end if;
    return jsonb_build_object('id',ticket.id,'reference',ticket.reference);
  end if;
  insert into public.trax_support_tickets(tenant_id,user_id,scope,issue_id,summary,handoff)
    values(target_tenant,target_user,repeat('0',64),ident,subject,'{"disclosure":"Opened by Drive247 support."}') returning * into ticket;
  perform public.trax_messaging_send(p_user,p_staff,null,true,ticket.id,ident,body);
  return jsonb_build_object('id',ticket.id,'reference',ticket.reference);
end $$;

revoke all on function public.trax_support_admin_targets(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.trax_support_admin_open(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.trax_support_admin_targets(uuid,uuid,uuid) to service_role;
grant execute on function public.trax_support_admin_open(uuid,uuid,jsonb) to service_role;
