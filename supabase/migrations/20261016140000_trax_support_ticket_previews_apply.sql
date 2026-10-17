-- Apply the ticket-list preview reader (20260917030000 was a review candidate and
-- never applied), WhatsApp-style: the latest message as one line, prefixed "You: "
-- when the viewer's own side wrote it, whitespace and line breaks collapsed.
-- New function only; the list query is untouched (messaging.ts merges previews in).
create or replace function public.trax_support_ticket_previews(p_user uuid,p_staff uuid,p_tenant uuid,p_admin boolean,p_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb;
begin
  perform public.trax_messaging_guard(p_user,p_staff,p_tenant,p_admin);
  if p_ids is null or array_length(p_ids,1) is null then return '{}'::jsonb; end if;
  if array_length(p_ids,1)>50 then raise exception 'invalid_support_page'; end if;
  -- Ownership is rechecked per ticket: a preview is a message body, and a tenant
  -- may only read their own.
  select coalesce(jsonb_object_agg(x.ticket_id::text,x.body),'{}'::jsonb) into rows from (
    select distinct on (m.ticket_id) m.ticket_id,
      case
        -- TRAX's automatic handoff summary is not a person's words.
        when m.author_kind='tenant' and m.nonce=t.issue_id and (t.conversation_id is not null or t.handoff ? 'conversationId')
          then 'TRAX shared its troubleshooting summary.'
        -- A status change's server-written note (messaging.ts STATUS_NOTE_NONCE) is an event, not a reply.
        when m.author_kind='support' and m.nonce::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-85a7-'
          then 'Marked as '||coalesce(substring(m.body from 'as (.+)\.$'),'updated')
        else (case when (p_admin and m.author_kind='support') or (not p_admin and m.author_kind='tenant') then 'You: ' else '' end)
          || left(btrim(regexp_replace(m.body,'\s+',' ','g')),160)
      end as body
    from public.trax_support_messages m
    join public.trax_support_tickets t on t.id=m.ticket_id
    where m.ticket_id = any(p_ids)
      and (p_admin or (t.tenant_id=p_tenant and t.user_id=p_user))
    order by m.ticket_id, m.seq desc
  ) x;
  return rows;
end $$;

revoke all on function public.trax_support_ticket_previews from public,anon,authenticated;
grant execute on function public.trax_support_ticket_previews to service_role;
