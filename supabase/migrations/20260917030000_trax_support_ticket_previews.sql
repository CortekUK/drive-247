-- Review candidate. Apply after 20260917020000. NOT APPLIED to any project by
-- this change: the inbox renders a preview only when the deployment answers with
-- one, so a project without this function keeps the list exactly as it is.
--
-- The ticket list shows the latest message as one truncated line. It is a
-- separate reader rather than a rewrite of `trax_messaging_request`, so the list
-- query, its paging and its unread counting stay exactly as reviewed.
create function public.trax_support_ticket_previews(p_user uuid,p_staff uuid,p_tenant uuid,p_admin boolean,p_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb;
begin
  perform public.trax_messaging_guard(p_user,p_staff,p_tenant,p_admin);
  if p_ids is null or array_length(p_ids,1) is null then return '{}'::jsonb; end if;
  if array_length(p_ids,1)>50 then raise exception 'invalid_support_page'; end if;
  -- Ownership is rechecked per ticket here too: a preview is a message body, and
  -- a tenant may only read their own.
  select coalesce(jsonb_object_agg(x.ticket_id::text,x.body),'{}'::jsonb) into rows from (
    select distinct on (m.ticket_id) m.ticket_id, left(btrim(m.body),160) as body
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
