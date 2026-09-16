-- REVIEW CANDIDATE ONLY. Do not apply to production or enable destructive
-- cleanup without the separately approved rollout/retention policy.
-- All new writes are confined to TRAX support state. No business tables change.
create table public.trax_support_agents (
  staff_id uuid primary key references public.app_users(id) on delete cascade,
  active boolean not null default true,
  can_manage_policy boolean not null default false
);
create table public.trax_support_retention_policy (
  id boolean primary key default true check(id),
  conversation_days integer not null default 90 check(conversation_days between 1 and 3650),
  closed_ticket_days integer not null default 365 check(closed_ticket_days between 1 and 3650),
  inactive_open_days integer not null default 90 check(inactive_open_days between 1 and 3650),
  cleanup_enabled boolean not null default false,
  cleanup_approved_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.trax_support_retention_policy(id) values(true);
create table public.trax_support_conversations (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null,
  scope text not null,
  revision integer not null default 1,
  state jsonb not null check(jsonb_typeof(state)='object' and octet_length(state::text)<=100000),
  last_activity_at timestamptz not null default now(),
  retention_hold boolean not null default false
);
create index trax_support_conversations_owner on public.trax_support_conversations(tenant_id,user_id,last_activity_at desc);
create table public.trax_support_tickets (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('TRX-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null,
  scope text not null,
  conversation_id uuid references public.trax_support_conversations(id) on delete set null,
  issue_id uuid not null unique,
  summary text not null check(length(summary) between 1 and 240),
  status text not null default 'open' check(status in ('open','in_progress','closed')),
  handoff jsonb not null check(jsonb_typeof(handoff)='object' and octet_length(handoff::text)<=60000),
  staff_note text not null default '' check(length(staff_note)<=2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  retention_hold boolean not null default false,
  check((status='closed')=(closed_at is not null))
);
create index trax_support_tickets_owner on public.trax_support_tickets(tenant_id,user_id,created_at desc);
create index trax_support_tickets_queue on public.trax_support_tickets(status,updated_at);
alter table public.trax_support_agents enable row level security;
alter table public.trax_support_retention_policy enable row level security;
alter table public.trax_support_conversations enable row level security;
alter table public.trax_support_tickets enable row level security;
-- Deliberately no browser policies. The V2 server revalidates membership, scope,
-- entity permissions and support grants; model tools cannot call these RPCs.
revoke all on public.trax_support_agents,public.trax_support_retention_policy,public.trax_support_conversations,public.trax_support_tickets from anon,authenticated;
grant all on public.trax_support_agents,public.trax_support_retention_policy,public.trax_support_conversations,public.trax_support_tickets to service_role;

create function public.trax_support_guard(p_user uuid,p_staff uuid,p_tenant uuid,p_scope text,p_agent boolean default false,p_manage boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare member public.app_users%rowtype;
begin
  select * into member from public.app_users where id=p_staff and auth_user_id=p_user and is_active=true for share;
  if member.id is null or (not coalesce(member.is_super_admin,false) and (member.tenant_id is distinct from p_tenant or member.role not in ('head_admin','admin','manager','ops','viewer')))
     or not exists(select 1 from public.tenants where id=p_tenant and status='active') or length(p_scope)<>64
  then raise exception 'support_access_denied'; end if;
  if p_agent and not exists(select 1 from public.trax_support_agents where staff_id=p_staff and active and (not p_manage or can_manage_policy)) then raise exception 'support_access_denied';end if;
end $$;
-- Recheck related records in the same transaction as the handoff write. The
-- server still checks the full current scope before and after the RPC.
create function public.trax_support_validate_records(p_staff uuid,p_tenant uuid,p_records jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; member public.app_users%rowtype; permission text; allowed boolean;
begin
  select * into member from public.app_users where id=p_staff;
  if jsonb_typeof(coalesce(p_records,'[]'))<>'array' or jsonb_array_length(coalesce(p_records,'[]'))>12 then raise exception 'support_access_denied';end if;
  for item in select value from jsonb_array_elements(coalesce(p_records,'[]')) loop
    permission=case item->>'kind' when 'vehicle' then 'vehicles' when 'rental' then 'rentals' when 'customer' then 'customers' else null end;
    if permission is null then raise exception 'support_access_denied';end if;
    if member.role='manager' and not coalesce(member.is_super_admin,false) then
      perform 1 from public.manager_permissions where app_user_id=p_staff and tab_key=permission and access_level in ('viewer','editor') for share;
      if not found then raise exception 'support_access_denied';end if;
    end if;
    allowed=false;
    if permission='vehicles' then select exists(select 1 from public.vehicles where id=(item->>'id')::uuid and tenant_id=p_tenant) into allowed;
    elsif permission='rentals' then select exists(select 1 from public.rentals where id=(item->>'id')::uuid and tenant_id=p_tenant) into allowed;
    elsif permission='customers' then select exists(select 1 from public.customers where id=(item->>'id')::uuid and tenant_id=p_tenant) into allowed;end if;
    if not allowed then raise exception 'support_access_denied';end if;
  end loop;
end $$;
create function public.trax_support_capabilities(p_user uuid,p_staff uuid,p_tenant uuid,p_scope text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.trax_support_guard(p_user,p_staff,p_tenant,p_scope);
  return jsonb_build_object('supportAgent',exists(select 1 from public.trax_support_agents where staff_id=p_staff and active),
    'managePolicy',exists(select 1 from public.trax_support_agents where staff_id=p_staff and active and can_manage_policy),
    'deliveryReady',exists(select 1 from public.trax_support_agents a join public.app_users u on u.id=a.staff_id where a.active and u.is_active));
end $$;
create function public.trax_support_save_conversation(p_user uuid,p_staff uuid,p_tenant uuid,p_scope text,p_id uuid,p_revision integer,p_state jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare next_revision integer;
begin
  perform public.trax_support_guard(p_user,p_staff,p_tenant,p_scope);
  if p_state->>'id' is distinct from p_id::text or jsonb_array_length(coalesce(p_state->'issues','[]'))>12 then raise exception 'invalid_support_state';end if;
  if p_revision is null then
    insert into public.trax_support_conversations(id,tenant_id,user_id,scope,state) values(p_id,p_tenant,p_user,p_scope,p_state) returning revision into next_revision;
  else
    update public.trax_support_conversations set state=p_state,revision=revision+1,last_activity_at=now()
      where id=p_id and tenant_id=p_tenant and user_id=p_user and scope=p_scope and revision=p_revision returning revision into next_revision;
    if next_revision is null then raise exception 'support_context_conflict';end if;
  end if;
  return next_revision;
end $$;
create function public.trax_support_submit_ticket(p_user uuid,p_staff uuid,p_tenant uuid,p_scope text,p_conversation uuid,p_issue uuid,p_summary text,p_handoff jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare conversation public.trax_support_conversations%rowtype; issue jsonb; ticket public.trax_support_tickets%rowtype;
begin
  perform public.trax_support_guard(p_user,p_staff,p_tenant,p_scope);
  perform public.trax_support_validate_records(p_staff,p_tenant,p_handoff->'recordReferences');
  select * into ticket from public.trax_support_tickets where issue_id=p_issue and tenant_id=p_tenant and user_id=p_user and scope=p_scope;
  if ticket.id is not null then return to_jsonb(ticket)-'scope';end if;
  select * into conversation from public.trax_support_conversations where id=p_conversation and tenant_id=p_tenant and user_id=p_user and scope=p_scope for update;
  if conversation.id is null then raise exception 'support_access_denied';end if;
  select value into issue from jsonb_array_elements(coalesce(conversation.state->'issues','[]')) where value->>'id'=p_issue::text;
  if issue is null or (issue->>'score')::integer<>100 or issue->>'state'='resolved' then raise exception 'issue_not_ready';end if;
  if not exists(select 1 from public.trax_support_agents a join public.app_users u on u.id=a.staff_id where a.active and u.is_active) then raise exception 'support_delivery_unavailable';end if;
  insert into public.trax_support_tickets(tenant_id,user_id,scope,conversation_id,issue_id,summary,handoff)
    values(p_tenant,p_user,p_scope,p_conversation,p_issue,p_summary,p_handoff)
    on conflict(issue_id) do nothing returning * into ticket;
  if ticket.id is null then select * into ticket from public.trax_support_tickets where issue_id=p_issue and tenant_id=p_tenant and user_id=p_user and scope=p_scope;end if;
  if ticket.id is null then raise exception 'support_access_denied';end if;
  update public.trax_support_conversations set state=jsonb_set(state,'{issues}',
    (select jsonb_agg(case when value->>'id'=p_issue::text then value||jsonb_build_object('ticketId',ticket.id,'state','submitted') else value end)
     from jsonb_array_elements(state->'issues'))),revision=revision+1,last_activity_at=now() where id=p_conversation;
  return to_jsonb(ticket)-'scope';
end $$;
create function public.trax_support_list_tickets(p_user uuid,p_staff uuid,p_tenant uuid,p_scope text,p_queue boolean,p_offset integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; policy public.trax_support_retention_policy%rowtype;
begin
  perform public.trax_support_guard(p_user,p_staff,p_tenant,p_scope,p_queue);
  if p_offset<0 or p_offset>100000 then raise exception 'invalid_support_page';end if;
  select * into policy from public.trax_support_retention_policy where id;
  select coalesce(jsonb_agg(to_jsonb(t)-'scope'-'handoff'-'staff_note'),'[]') into rows from
    (select *,status<>'closed' and updated_at<now()-make_interval(days=>policy.inactive_open_days) as review_due
     from public.trax_support_tickets where p_queue or (tenant_id=p_tenant and user_id=p_user and scope=p_scope)
     order by created_at desc,id limit 21 offset p_offset) t;
  return jsonb_build_object('tickets',case when jsonb_array_length(rows)>20 then rows-20 else rows end,'nextOffset',case when jsonb_array_length(rows)>20 then p_offset+20 else null end);
end $$;
create function public.trax_support_ticket_detail(p_user uuid,p_staff uuid,p_tenant uuid,p_scope text,p_id uuid,p_queue boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket public.trax_support_tickets%rowtype;
begin
  perform public.trax_support_guard(p_user,p_staff,p_tenant,p_scope,p_queue);
  select * into ticket from public.trax_support_tickets where id=p_id and (p_queue or (tenant_id=p_tenant and user_id=p_user and scope=p_scope));
  if ticket.id is null then raise exception 'support_access_denied';end if;
  return to_jsonb(ticket)-'scope';
end $$;
create function public.trax_support_update_ticket(p_user uuid,p_staff uuid,p_tenant uuid,p_scope text,p_id uuid,p_status text,p_note text,p_hold boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket public.trax_support_tickets%rowtype;
begin
  perform public.trax_support_guard(p_user,p_staff,p_tenant,p_scope,true);
  if p_status not in ('open','in_progress','closed') or length(p_note)>2000 then raise exception 'invalid_support_update';end if;
  select * into ticket from public.trax_support_tickets where id=p_id for update;
  if ticket.id is null then raise exception 'support_access_denied';end if;
  if p_hold<>ticket.retention_hold then perform public.trax_support_guard(p_user,p_staff,p_tenant,p_scope,true,true);end if;
  update public.trax_support_tickets set status=p_status,staff_note=p_note,retention_hold=p_hold,updated_at=now(),
    closed_at=case when p_status<>'closed' then null when status<>'closed' then now() else closed_at end
    where id=p_id returning * into ticket;
  return to_jsonb(ticket)-'scope';
end $$;
create function public.trax_support_policy(p_user uuid,p_staff uuid,p_tenant uuid,p_scope text,p_update jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare policy public.trax_support_retention_policy%rowtype;
begin
  perform public.trax_support_guard(p_user,p_staff,p_tenant,p_scope,true,true);
  if p_update is not null then
    if (p_update - array['conversation_days','closed_ticket_days','inactive_open_days'])<>'{}'::jsonb then raise exception 'invalid_support_policy';end if;
    update public.trax_support_retention_policy set conversation_days=(p_update->>'conversation_days')::integer,
      closed_ticket_days=(p_update->>'closed_ticket_days')::integer,inactive_open_days=(p_update->>'inactive_open_days')::integer,updated_at=now() where id;
  end if;
  select * into policy from public.trax_support_retention_policy where id;
  return jsonb_build_object('conversation_days',policy.conversation_days,'closed_ticket_days',policy.closed_ticket_days,
    'inactive_open_days',policy.inactive_open_days,'cleanup_enabled',policy.cleanup_enabled);
end $$;
create function public.trax_support_hold_conversation(p_user uuid,p_staff uuid,p_tenant uuid,p_scope text,p_id uuid,p_hold boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.trax_support_guard(p_user,p_staff,p_tenant,p_scope,true,true);
  update public.trax_support_conversations set retention_hold=p_hold where id=p_id;
  if not found then raise exception 'support_access_denied';end if;
end $$;
create function public.trax_support_cleanup(p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare policy public.trax_support_retention_policy%rowtype; conversations integer; tickets integer; review_count integer;
begin
  select * into policy from public.trax_support_retention_policy where id;
  if not p_dry_run and (not policy.cleanup_enabled or policy.cleanup_approved_at is null) then raise exception 'destructive_cleanup_not_approved';end if;
  select count(*) into conversations from public.trax_support_conversations where not retention_hold and last_activity_at<now()-make_interval(days=>policy.conversation_days);
  select count(*) into tickets from public.trax_support_tickets where not retention_hold and status='closed' and closed_at<now()-make_interval(days=>policy.closed_ticket_days);
  select count(*) into review_count from public.trax_support_tickets where status<>'closed' and updated_at<now()-make_interval(days=>policy.inactive_open_days);
  if not p_dry_run then
    delete from public.trax_support_tickets where not retention_hold and status='closed' and closed_at<now()-make_interval(days=>policy.closed_ticket_days);
    delete from public.trax_support_conversations where not retention_hold and last_activity_at<now()-make_interval(days=>policy.conversation_days);
  end if;
  return jsonb_build_object('dryRun',p_dry_run,'conversationsEligible',conversations,'closedTicketsEligible',tickets,'openTicketsForReview',review_count);
end $$;
create function public.trax_support_retention_preview(p_user uuid,p_staff uuid,p_tenant uuid,p_scope text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin perform public.trax_support_guard(p_user,p_staff,p_tenant,p_scope,true,true);return public.trax_support_cleanup(true);end $$;
-- Installing this migration schedules DRY RUN only when pg_cron is available.
-- No existing scheduler, business record, legacy chat or shared knowledge changes.
do $$
declare f record;
begin
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'trax_support_%' loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('trax-support-retention-dry-run','17 3 * * *','select public.trax_support_cleanup(true)');
  end if;
end $$;
