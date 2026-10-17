-- Super Admin Support: combinable list filters, per-viewer stars, filter facets.
--
-- Additive only. New table trax_support_stars (service_role only, like every
-- other trax_support_* table). trax_messaging_request keeps its signature; the
-- list branch accepts extra OPTIONAL filter keys and returns three extra row
-- fields (tenant_id, requester_id for the platform view; starred), and two new
-- actions exist: facets (platform only) and star (platform only). A caller that
-- sends none of the new keys gets exactly the list it got before.
create table if not exists public.trax_support_stars (
  user_id uuid not null,
  ticket_id uuid not null references public.trax_support_tickets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, ticket_id)
);
alter table public.trax_support_stars enable row level security;
revoke all on public.trax_support_stars from anon, authenticated;
create index if not exists trax_support_stars_ticket on public.trax_support_stars(ticket_id);

CREATE OR REPLACE FUNCTION public.trax_messaging_request(p_user uuid, p_staff uuid, p_tenant uuid, p_admin boolean, p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ticket public.trax_support_tickets%rowtype; rows jsonb; total integer; before_seq integer;
  filter_status text; query text; f_statuses text[]; f_tenants uuid[]; f_requesters uuid[]; f_reference text; f_from date; f_to date; f_unread boolean; f_starred boolean; offset_n integer; seen integer; ident uuid; body text;
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
    -- Combinable filters (all optional; absent = no constraint). Every one narrows
    -- the SAME authorized set the plain list returns, never widens it.
    f_statuses=coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p_data->'statuses')='array' then p_data->'statuses' else '[]' end)),'{}');
    f_tenants=coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p_data->'tenants')='array' then p_data->'tenants' else '[]' end)::uuid),'{}');
    f_requesters=coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p_data->'requesters')='array' then p_data->'requesters' else '[]' end)::uuid),'{}');
    f_reference=btrim(coalesce(p_data->>'reference',''));
    f_from=nullif(p_data->>'createdFrom','')::date; f_to=nullif(p_data->>'createdTo','')::date;
    f_unread=coalesce((p_data->>'unread')::boolean,false); f_starred=coalesce((p_data->>'starred')::boolean,false);
    if cardinality(f_statuses)>3 or not f_statuses<@array['open','in_progress','closed'] or cardinality(f_tenants)>200 or cardinality(f_requesters)>200 or length(f_reference)>40 then raise exception 'invalid_support_page';end if;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
      select t.id,t.reference,t.summary,t.status,t.updated_at,t.created_at,coalesce(n.company_name,n.slug,'Rental company') as tenant_name,
        coalesce(u.name,'Requester') as requester,
        case when p_admin then t.tenant_id end as tenant_id, case when p_admin then t.user_id end as requester_id,
        exists(select 1 from public.trax_support_stars s where s.ticket_id=t.id and s.user_id=p_user) as starred,
        exists(select 1 from public.trax_support_messages m where m.ticket_id=t.id and m.author_kind=case when p_admin then 'tenant' else 'support' end
          and m.seq>coalesce((select last_seq from public.trax_support_reads where ticket_id=t.id and user_id=p_user),0)) as unread
      from public.trax_support_tickets t join public.tenants n on n.id=t.tenant_id left join public.app_users u on u.auth_user_id=t.user_id
      where (p_admin or (t.tenant_id=p_tenant and t.user_id=p_user)) and (filter_status='' or t.status=filter_status)
        and (query='' or position(lower(query) in lower(t.reference||' '||t.summary||' '||coalesce(n.company_name,n.slug,'')||' '||coalesce(u.name,'')))>0)
        and (cardinality(f_statuses)=0 or t.status=any(f_statuses))
        and (cardinality(f_tenants)=0 or t.tenant_id=any(f_tenants))
        and (cardinality(f_requesters)=0 or t.user_id=any(f_requesters))
        and (f_reference='' or position(lower(f_reference) in lower(t.reference))>0)
        and (f_from is null or t.created_at>=f_from::timestamptz)
        and (f_to is null or t.created_at<(f_to+1)::timestamptz)
        and (not f_starred or exists(select 1 from public.trax_support_stars s where s.ticket_id=t.id and s.user_id=p_user))
        -- Unread = the same rule as the row badges (messaging.ts unreadByTicket):
        -- incoming messages past this viewer's read-through, minus status notes
        -- (requester) and TRAX's generated summary (platform support).
        and (not f_unread or exists(select 1 from public.trax_support_messages m where m.ticket_id=t.id
          and m.author_kind=case when p_admin then 'tenant' else 'support' end
          and m.seq>coalesce((select last_seq from public.trax_support_reads where ticket_id=t.id and user_id=p_user),0)
          and not (not p_admin and m.nonce::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-85a7-')
          and not (p_admin and m.nonce=t.issue_id and (t.handoff->>'conversationId' is not null or t.conversation_id is not null))))
      order by t.updated_at desc,t.id limit 26 offset offset_n
    ) x;
    return jsonb_build_object('tickets',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'nextOffset',case when jsonb_array_length(rows)>25 then offset_n+25 else null end,'unread',total);
  end if;
  if p_action='facets' then
    -- The filter panel's choices: every company and requester that has a ticket.
    if not p_admin then raise exception 'support_access_denied';end if;
    return jsonb_build_object(
      'tenants',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'count',x.n) order by x.name),'[]') from (
        select n.id,coalesce(n.company_name,n.slug,'Rental company') as name,count(*) n from public.trax_support_tickets t join public.tenants n on n.id=t.tenant_id group by n.id,n.company_name,n.slug) x),
      'requesters',(select coalesce(jsonb_agg(jsonb_build_object('id',x.user_id,'name',x.name,'tenantId',x.tenant_id,'count',x.n) order by x.name),'[]') from (
        select t.user_id,t.tenant_id,coalesce(max(u.name),'Requester') as name,count(*) n from public.trax_support_tickets t left join public.app_users u on u.auth_user_id=t.user_id group by t.user_id,t.tenant_id) x));
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
  elsif p_action='star' then
    -- A personal mark: this viewer's own star on a ticket they may open.
    if not p_admin then raise exception 'support_access_denied';end if;
    if coalesce((p_data->>'starred')::boolean,false) then
      insert into public.trax_support_stars(user_id,ticket_id) values(p_user,ticket.id) on conflict do nothing;
    else
      delete from public.trax_support_stars where user_id=p_user and ticket_id=ticket.id;
    end if;
    return jsonb_build_object('starred',coalesce((p_data->>'starred')::boolean,false));
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
end $function$;
