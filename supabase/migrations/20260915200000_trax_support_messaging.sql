-- Review candidate. Apply after 20260915190000; no production cleanup is enabled.
-- Human support writes only. Browser roles have no direct table/RPC access.
alter table public.trax_support_tickets add column message_seq integer not null default 0;
create table public.trax_support_messages (
  ticket_id uuid not null references public.trax_support_tickets(id) on delete cascade,
  seq integer not null,
  author_user uuid not null,
  author_kind text not null check(author_kind in ('tenant','support')),
  nonce uuid not null,
  body text not null check(length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  primary key(ticket_id,seq), unique(ticket_id,author_user,nonce)
);
create table public.trax_support_reads (
  ticket_id uuid not null references public.trax_support_tickets(id) on delete cascade,
  user_id uuid not null, last_seq integer not null default 0,
  primary key(ticket_id,user_id)
);
create table public.trax_support_email_jobs (
  ticket_id uuid primary key references public.trax_support_tickets(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','sending','sent','failed','review')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  first_attempt_at timestamptz, lease uuid, lease_until timestamptz,
  payload jsonb, provider_id text, last_error text,
  created_at timestamptz not null default now()
);
alter table public.trax_support_messages enable row level security;
alter table public.trax_support_reads enable row level security;
alter table public.trax_support_email_jobs enable row level security;
revoke all on public.trax_support_messages,public.trax_support_reads,public.trax_support_email_jobs from public,anon,authenticated;
grant all on public.trax_support_messages,public.trax_support_reads,public.trax_support_email_jobs to service_role;
create index trax_support_messages_incoming on public.trax_support_messages(ticket_id,author_kind,seq);
create index trax_support_messages_author_activity on public.trax_support_messages(author_user,created_at desc);
create index trax_support_tickets_requester_activity on public.trax_support_tickets(user_id,created_at desc);
create index trax_support_email_ready on public.trax_support_email_jobs(status,available_at);

-- One authorization rule for every list, count, message, status and read request.
-- Platform support requires BOTH the actual platform flag and an explicit grant.
create function public.trax_messaging_guard(p_user uuid,p_staff uuid,p_tenant uuid,p_admin boolean)
returns void language plpgsql security definer set search_path='' as $$
declare member public.app_users%rowtype;
begin
  select * into member from public.app_users where id=p_staff and auth_user_id=p_user and is_active for share;
  if member.id is null then raise exception 'support_access_denied'; end if;
  if p_admin then
    if not coalesce(member.is_super_admin,false) then raise exception 'support_access_denied';end if;
    perform 1 from public.trax_support_agents where staff_id=p_staff and active for share;
    if not found then raise exception 'support_access_denied';end if;
  elsif (not coalesce(member.is_super_admin,false) and member.tenant_id is distinct from p_tenant)
     or not exists(select 1 from public.tenants where id=p_tenant and status='active')
     or (not coalesce(member.is_super_admin,false) and member.role not in ('head_admin','admin','manager','ops','viewer')) then
    raise exception 'support_access_denied';
  end if;
end $$;

-- Authorization does not depend on an old chat scope: owners can return after
-- login/permission changes. Sensitive handoffs are separately revalidated.
create function public.trax_messaging_ticket(p_user uuid,p_staff uuid,p_tenant uuid,p_admin boolean,p_id uuid)
returns public.trax_support_tickets language plpgsql security definer set search_path='' as $$
declare ticket public.trax_support_tickets%rowtype;
begin
  perform public.trax_messaging_guard(p_user,p_staff,p_tenant,p_admin);
  select * into ticket from public.trax_support_tickets where id=p_id and (p_admin or (tenant_id=p_tenant and user_id=p_user)) for update;
  if ticket.id is null then raise exception 'support_access_denied';end if;
  return ticket;
end $$;

create function public.trax_messaging_send(p_user uuid,p_staff uuid,p_tenant uuid,p_admin boolean,p_id uuid,p_nonce uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket public.trax_support_tickets%rowtype; message public.trax_support_messages%rowtype;
begin
  ticket=public.trax_messaging_ticket(p_user,p_staff,p_tenant,p_admin,p_id);
  if p_nonce is null or p_body is null or length(btrim(p_body)) not between 1 and 4000 then raise exception 'invalid_support_message';end if;
  select * into message from public.trax_support_messages where ticket_id=p_id and author_user=p_user and nonce=p_nonce;
  if message.seq is not null then return to_jsonb(message)-'author_user'-'nonce';end if;
  if (select count(*) from public.trax_support_messages where author_user=p_user and created_at>now()-interval '1 minute')>=30 then raise exception 'support_rate_limited';end if;
  insert into public.trax_support_messages(ticket_id,seq,author_user,author_kind,nonce,body)
    values(p_id,ticket.message_seq+1,p_user,case when p_admin then 'support' else 'tenant' end,p_nonce,btrim(p_body)) returning * into message;
  update public.trax_support_tickets set message_seq=message.seq,updated_at=now(),
    status=case when not p_admin and status='closed' then 'open' else status end,
    closed_at=case when not p_admin then null else closed_at end where id=p_id;
  return to_jsonb(message)-'author_user'-'nonce';
end $$;

-- Calls the existing escalation handoff writer and the message writer in ONE
-- transaction. A failing first message rolls back the ticket, issue and email job.
create function public.trax_support_submit_message(p_user uuid,p_staff uuid,p_tenant uuid,p_scope text,p_conversation uuid,p_issue uuid,p_summary text,p_handoff jsonb,p_nonce uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket jsonb; new_ticket boolean;
begin
  perform public.trax_messaging_guard(p_user,p_staff,p_tenant,false);
  new_ticket=not exists(select 1 from public.trax_support_tickets where issue_id=p_issue);
  ticket=public.trax_support_submit_ticket(p_user,p_staff,p_tenant,p_scope,p_conversation,p_issue,p_summary,p_handoff);
  -- Already-submitted issues open the existing thread; a new nonce must not
  -- append another "first" message on refresh or a competing submission.
  perform 1 from public.trax_support_tickets where id=(ticket->>'id')::uuid for update;
  if not exists(select 1 from public.trax_support_messages where ticket_id=(ticket->>'id')::uuid) then
    perform public.trax_messaging_send(p_user,p_staff,p_tenant,false,(ticket->>'id')::uuid,p_nonce,p_body);
  end if;
  if new_ticket then insert into public.trax_support_email_jobs(ticket_id) values((ticket->>'id')::uuid) on conflict do nothing;end if;
  return ticket;
end $$;

create function public.trax_messaging_request(p_user uuid,p_staff uuid,p_tenant uuid,p_admin boolean,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket public.trax_support_tickets%rowtype; rows jsonb; total integer; before_seq integer;
  filter_status text; query text; offset_n integer; seen integer; ident uuid; body text;
begin
  perform public.trax_messaging_guard(p_user,p_staff,p_tenant,p_admin);
  if p_action='create' then
    if p_admin then raise exception 'support_access_denied';end if;
    ident=(p_data->>'nonce')::uuid; body=p_data->>'body';
    if ident is null or length(btrim(coalesce(body,''))) not between 1 and 4000 or length(btrim(coalesce(p_data->>'subject',''))) not between 1 and 240 then raise exception 'invalid_support_message';end if;
    -- Serialize first-message retries using a transaction lock scoped to nonce.
    perform pg_advisory_xact_lock(hashtextextended(ident::text,0));
    select * into ticket from public.trax_support_tickets where issue_id=ident;
    if ticket.id is not null and (ticket.tenant_id<>p_tenant or ticket.user_id<>p_user) then raise exception 'support_access_denied';end if;
    if ticket.id is null then
      if (select count(*) from public.trax_support_tickets where user_id=p_user and created_at>now()-interval '1 hour')>=10 then raise exception 'support_rate_limited';end if;
      insert into public.trax_support_tickets(tenant_id,user_id,scope,issue_id,summary,handoff)
        values(p_tenant,p_user,repeat('0',64),ident,btrim(p_data->>'subject'),'{"disclosure":"Reported directly by the requester. No TRAX checks were performed."}') returning * into ticket;
      perform public.trax_messaging_send(p_user,p_staff,p_tenant,false,ticket.id,ident,body);
      insert into public.trax_support_email_jobs(ticket_id) values(ticket.id) on conflict do nothing;
    end if;
    return jsonb_build_object('id',ticket.id,'reference',ticket.reference);
  end if;
  if p_action in ('count','list') then
    select count(*) into total from public.trax_support_tickets t
      where (p_admin or (t.tenant_id=p_tenant and t.user_id=p_user)) and exists(
        select 1 from public.trax_support_messages m where m.ticket_id=t.id and m.author_kind=case when p_admin then 'tenant' else 'support' end
        and m.seq>coalesce((select last_seq from public.trax_support_reads where ticket_id=t.id and user_id=p_user),0));
    if p_action='count' then return jsonb_build_object('unread',total);end if;
    query=coalesce(p_data->>'search','');filter_status=coalesce(p_data->>'status','');offset_n=coalesce((p_data->>'offset')::integer,0);
    if length(query)>120 or offset_n not between 0 and 10000 or filter_status not in ('','open','in_progress','closed') then raise exception 'invalid_support_page';end if;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
      select t.id,t.reference,t.summary,t.status,t.updated_at,t.created_at,coalesce(n.company_name,n.slug,'Rental company') as tenant_name,
        coalesce(u.name,'Requester') as requester,
        exists(select 1 from public.trax_support_messages m where m.ticket_id=t.id and m.author_kind=case when p_admin then 'tenant' else 'support' end
          and m.seq>coalesce((select last_seq from public.trax_support_reads where ticket_id=t.id and user_id=p_user),0)) as unread
      from public.trax_support_tickets t join public.tenants n on n.id=t.tenant_id left join public.app_users u on u.auth_user_id=t.user_id
      where (p_admin or (t.tenant_id=p_tenant and t.user_id=p_user)) and (filter_status='' or t.status=filter_status)
        and (query='' or position(lower(query) in lower(t.reference||' '||t.summary||' '||coalesce(n.company_name,n.slug,'')||' '||coalesce(u.name,'')))>0)
      order by t.updated_at desc,t.id limit 26 offset offset_n
    ) x;
    return jsonb_build_object('tickets',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'nextOffset',case when jsonb_array_length(rows)>25 then offset_n+25 else null end,'unread',total);
  end if;
  ticket=public.trax_messaging_ticket(p_user,p_staff,p_tenant,p_admin,(p_data->>'id')::uuid);
  if p_action='send' then
    return public.trax_messaging_send(p_user,p_staff,p_tenant,p_admin,ticket.id,(p_data->>'nonce')::uuid,p_data->>'body');
  elsif p_action='read' then
    seen=(p_data->>'through')::integer;
    if seen is null or seen<0 or seen>ticket.message_seq then raise exception 'invalid_support_read';end if;
    insert into public.trax_support_reads(ticket_id,user_id,last_seq) values(ticket.id,p_user,seen)
      on conflict(ticket_id,user_id) do update set last_seq=greatest(public.trax_support_reads.last_seq,excluded.last_seq);
    return jsonb_build_object('readThrough',seen);
  elsif p_action='status' then
    if not p_admin or coalesce(p_data->>'status','') not in ('open','in_progress','closed') then raise exception 'support_access_denied';end if;
    if exists(select 1 from public.trax_support_messages where ticket_id=ticket.id and author_user=p_user and nonce=(p_data->>'nonce')::uuid) then return jsonb_build_object('status',ticket.status);end if;
    -- Status and the human resolution/update message commit together.
    perform public.trax_messaging_send(p_user,p_staff,p_tenant,true,ticket.id,(p_data->>'nonce')::uuid,p_data->>'body');
    update public.trax_support_tickets set status=p_data->>'status',updated_at=now(),
      closed_at=case when p_data->>'status'<>'closed' then null when status<>'closed' then now() else closed_at end where id=ticket.id;
    return jsonb_build_object('status',p_data->>'status');
  elsif p_action='detail' then
    before_seq=coalesce((p_data->>'before')::integer,ticket.message_seq+1);
    if before_seq<1 then raise exception 'invalid_support_page';end if;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.seq),'[]') into rows from (
      select m.seq,m.author_kind,m.body,m.created_at from public.trax_support_messages m where m.ticket_id=ticket.id and m.seq<before_seq order by m.seq desc limit 50
    ) x;
    -- A permission change may remove access to diagnostics, but never to the
    -- owner's own human conversation. Hide the handoff when records fail checks.
    if not p_admin then begin
      perform public.trax_support_validate_records(p_staff,ticket.tenant_id,ticket.handoff->'recordReferences');
    exception when others then ticket.handoff='{"disclosure":"Diagnostic context is unavailable with your current record permissions."}';end;end if;
    return jsonb_build_object('ticket',(to_jsonb(ticket)-'scope'-'user_id'-'issue_id')||jsonb_build_object(
      'tenant_name',(select coalesce(company_name,slug) from public.tenants where id=ticket.tenant_id),
      'requester',(select name from public.app_users where auth_user_id=ticket.user_id),
      'emailStatus',case when p_admin then (select status from public.trax_support_email_jobs where ticket_id=ticket.id) else null end),
      'messages',rows,'hasOlder',coalesce((rows->0->>'seq')::integer,1)>1,'latestSeq',ticket.message_seq);
  end if;
  raise exception 'invalid_support_action';
end $$;
create function public.trax_support_email_prepare(p_id uuid,p_lease uuid,p_envelope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  update public.trax_support_email_jobs set payload=case when payload ? 'envelope' then payload else payload||jsonb_build_object('envelope',p_envelope) end
    where ticket_id=p_id and lease=p_lease and status='sending' returning payload->'envelope' into result;
  if result is null then raise exception 'notification_lease_changed';end if;
  return result;
end $$;

-- Claim durable notification work with a lease. No request sends email inline.
create function public.trax_support_email_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.trax_support_email_jobs%rowtype; ticket public.trax_support_tickets%rowtype;
begin
  -- Resend's dedupe window is 24h. Stop uncertain automatic retries before it
  -- expires, and require support review instead of risking a second email.
  update public.trax_support_email_jobs set status='review',last_error='Delivery needs review after retry window'
    where status in ('pending','failed','sending') and first_attempt_at<now()-interval '23 hours';
  select * into job from public.trax_support_email_jobs where
    ((status in ('pending','failed') and available_at<=now()) or (status='sending' and lease_until<now())) and attempts<8
    order by created_at for update skip locked limit 1;
  if job.ticket_id is null then return null;end if;
  select * into ticket from public.trax_support_tickets where id=job.ticket_id;
  update public.trax_support_email_jobs set status='sending',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',
    first_attempt_at=coalesce(first_attempt_at,now()),payload=coalesce(payload,jsonb_build_object('id',ticket.id,'reference',ticket.reference,'subject',ticket.summary,
    'createdAt',ticket.created_at,'tenant',(select coalesce(company_name,slug) from public.tenants where id=ticket.tenant_id),
    'requester',(select name from public.app_users where auth_user_id=ticket.user_id),
    'message',(select body from public.trax_support_messages where ticket_id=ticket.id and seq=1)))
    where ticket_id=job.ticket_id returning * into job;
  return to_jsonb(job);
end $$;
create function public.trax_support_email_finish(p_id uuid,p_lease uuid,p_provider_id text,p_error text)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.trax_support_email_jobs set status=case when p_provider_id is not null then 'sent' when attempts>=8 then 'review' else 'failed' end,
    provider_id=p_provider_id,last_error=left(p_error,160),available_at=now()+interval '5 minutes'*power(2,least(attempts,6)),lease_until=null
    where ticket_id=p_id and lease=p_lease and status='sending';
  if not found then raise exception 'notification_lease_changed';end if;
end $$;
revoke all on function public.trax_messaging_guard,public.trax_messaging_ticket,public.trax_messaging_send,public.trax_messaging_request,public.trax_support_submit_message,public.trax_support_email_claim,public.trax_support_email_finish from public,anon,authenticated;
grant execute on function public.trax_messaging_guard,public.trax_messaging_ticket,public.trax_messaging_send,public.trax_messaging_request,public.trax_support_submit_message,public.trax_support_email_claim,public.trax_support_email_finish to service_role;
revoke all on function public.trax_support_email_prepare from public,anon,authenticated;
grant execute on function public.trax_support_email_prepare to service_role;

-- Apply the same platform restriction to the older queue/status endpoints.
create or replace function public.trax_support_guard(p_user uuid,p_staff uuid,p_tenant uuid,p_scope text,p_agent boolean default false,p_manage boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare member public.app_users%rowtype;
begin
  select * into member from public.app_users where id=p_staff and auth_user_id=p_user and is_active=true for share;
  if member.id is null or (not coalesce(member.is_super_admin,false) and (member.tenant_id is distinct from p_tenant or member.role not in ('head_admin','admin','manager','ops','viewer')))
     or not exists(select 1 from public.tenants where id=p_tenant and status='active') or length(p_scope)<>64
  then raise exception 'support_access_denied'; end if;
  if p_agent and (not coalesce(member.is_super_admin,false) or not exists(select 1 from public.trax_support_agents where staff_id=p_staff and active and (not p_manage or can_manage_policy))) then raise exception 'support_access_denied';end if;
end $$;
