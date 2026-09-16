-- Review candidate. Apply after 20260915200000. Attachments for the in-app support
-- conversation: the requester can send a screenshot or a document, and support can
-- send one back. Nothing here is enabled until the private storage bucket named in
-- docs/trax/in-app-support.md exists; no production cleanup is scheduled.
--
-- The FILE never travels through the support API. The client asks for a reserved
-- path, uploads straight to private storage with a short-lived signed upload URL,
-- and the message that follows claims it by its nonce. A reserved row that never
-- gets a message stays unlinked and is purged; a message is never blocked by it.
create table public.trax_support_attachments (
  id uuid primary key default gen_random_uuid(),
  -- Null until the first message of a NEW ticket commits: the ticket does not
  -- exist yet when its screenshot is uploaded.
  ticket_id uuid references public.trax_support_tickets(id) on delete cascade,
  message_seq integer,
  tenant_id uuid not null,
  author_user uuid not null,
  author_kind text not null check(author_kind in ('tenant','support')),
  nonce uuid not null,
  storage_path text not null unique,
  file_name text not null check(length(btrim(file_name)) between 1 and 200),
  -- Screenshots and documents only. No archives, no executables, no SVG (script).
  mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp','image/gif','application/pdf')),
  size_bytes integer not null check(size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);
alter table public.trax_support_attachments enable row level security;
revoke all on public.trax_support_attachments from public,anon,authenticated;
grant all on public.trax_support_attachments to service_role;
create index trax_support_attachments_message on public.trax_support_attachments(ticket_id,message_seq);
create index trax_support_attachments_pending on public.trax_support_attachments(author_user,nonce) where message_seq is null;

-- Reserve one upload. Access is the same rule every other support action uses, and
-- a ticket that is named must be one this account may already write to.
create function public.trax_support_attachment_reserve(
  p_user uuid,p_staff uuid,p_tenant uuid,p_admin boolean,p_ticket uuid,p_nonce uuid,
  p_name text,p_mime text,p_size integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket public.trax_support_tickets%rowtype; path text; row public.trax_support_attachments%rowtype;
begin
  perform public.trax_messaging_guard(p_user,p_staff,p_tenant,p_admin);
  if p_nonce is null or p_name is null or p_mime is null or p_size is null then raise exception 'invalid_support_attachment';end if;
  if p_ticket is not null then ticket=public.trax_messaging_ticket(p_user,p_staff,p_tenant,p_admin,p_ticket);end if;
  -- Support staff never attach to a ticket they have not opened; a tenant never
  -- attaches to someone else's. `trax_messaging_ticket` already enforced both.
  if (select count(*) from public.trax_support_attachments where author_user=p_user and nonce=p_nonce)>=3 then raise exception 'support_attachment_limit';end if;
  if (select count(*) from public.trax_support_attachments where author_user=p_user and created_at>now()-interval '1 hour')>=30 then raise exception 'support_rate_limited';end if;
  path=coalesce(p_tenant::text,'platform')||'/'||coalesce(p_ticket::text,'new')||'/'||gen_random_uuid()::text;
  insert into public.trax_support_attachments(ticket_id,tenant_id,author_user,author_kind,nonce,storage_path,file_name,mime_type,size_bytes)
    values(p_ticket,coalesce(p_tenant,ticket.tenant_id),p_user,case when p_admin then 'support' else 'tenant' end,p_nonce,path,btrim(p_name),p_mime,p_size)
    returning * into row;
  return jsonb_build_object('id',row.id,'storagePath',row.storage_path,'fileName',row.file_name,'mimeType',row.mime_type,'sizeBytes',row.size_bytes);
end $$;

-- What a ticket's conversation carries, for the reader the guard allows.
create function public.trax_support_attachment_list(p_user uuid,p_staff uuid,p_tenant uuid,p_admin boolean,p_ticket uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb;
begin
  perform public.trax_messaging_ticket(p_user,p_staff,p_tenant,p_admin,p_ticket);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.seq,x.created_at),'[]') into rows from (
    select a.id,a.message_seq as seq,a.storage_path as path,a.file_name as name,a.mime_type as mime,a.size_bytes as size,a.author_kind,a.created_at
    from public.trax_support_attachments a where a.ticket_id=p_ticket and a.message_seq is not null
  ) x;
  return rows;
end $$;

-- Claim the reserved uploads when their message commits. Replaces the original
-- writer; everything else about it is unchanged, so an existing nonce still
-- returns the stored message instead of appending a second one.
create or replace function public.trax_messaging_send(p_user uuid,p_staff uuid,p_tenant uuid,p_admin boolean,p_id uuid,p_nonce uuid,p_body text)
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
  -- The uploads this author reserved under this nonce belong to this message.
  update public.trax_support_attachments set ticket_id=p_id,message_seq=message.seq
    where author_user=p_user and nonce=p_nonce and message_seq is null;
  return to_jsonb(message)-'author_user'-'nonce';
end $$;

-- Reserved uploads whose message never arrived. Deleting the row is safe on its
-- own: the stored object is removed by the same caller, and an object without a
-- row can never be listed or signed.
create function public.trax_support_attachment_purge(p_older_than interval default interval '24 hours')
returns jsonb language plpgsql security definer set search_path='' as $$
declare paths jsonb;
begin
  with gone as (
    delete from public.trax_support_attachments
    where message_seq is null and created_at < now()-p_older_than returning storage_path)
  select coalesce(jsonb_agg(storage_path),'[]') into paths from gone;
  return jsonb_build_object('paths',paths);
end $$;

revoke all on function public.trax_support_attachment_reserve,public.trax_support_attachment_list,public.trax_support_attachment_purge from public,anon,authenticated;
grant execute on function public.trax_support_attachment_reserve,public.trax_support_attachment_list,public.trax_support_attachment_purge to service_role;
