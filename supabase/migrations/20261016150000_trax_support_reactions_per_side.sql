-- A reaction belongs to a side as well as a person. One login can be on both
-- sides of a ticket (a super admin who also raises tickets from a tenant
-- portal), and keyed by user alone the support reaction replaced the tenant one
-- and either side could clear it. Now each side owns its own reaction.

alter table public.trax_support_message_reactions
  drop constraint trax_support_message_reaction_ticket_id_message_seq_actor_u_key;
alter table public.trax_support_message_reactions
  add constraint trax_support_message_reactions_one_per_side unique (ticket_id, message_seq, actor_kind, actor_user);

create or replace function public.trax_support_react(p_user uuid, p_staff uuid, p_tenant uuid, p_admin boolean, p_ticket uuid, p_seq integer, p_emoji text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare side text := case when p_admin then 'support' else 'tenant' end;
begin
  perform public.trax_messaging_guard(p_user, p_staff, p_tenant, p_admin);
  if p_emoji is not null and p_emoji not in ('👍','❤️','😂','😮','🙏') then raise exception 'invalid_support_reaction'; end if;
  -- The same ownership rule as the thread: a tenant reacts only in their own tickets.
  if not exists (
    select 1 from public.trax_support_tickets t
    where t.id = p_ticket and (p_admin or (t.tenant_id = p_tenant and t.user_id = p_user))
  ) then raise exception 'support_access_denied'; end if;
  if not exists (select 1 from public.trax_support_messages m where m.ticket_id = p_ticket and m.seq = p_seq) then
    raise exception 'invalid_support_reaction';
  end if;
  -- Only ever the caller's own reaction, on the caller's own side.
  if p_emoji is null then
    delete from public.trax_support_message_reactions
    where ticket_id = p_ticket and message_seq = p_seq and actor_kind = side and actor_user = p_user;
  else
    insert into public.trax_support_message_reactions (ticket_id, message_seq, actor_kind, actor_user, emoji)
    values (p_ticket, p_seq, side, p_user, p_emoji)
    on conflict (ticket_id, message_seq, actor_kind, actor_user) do update set emoji = excluded.emoji, updated_at = now();
  end if;
  return public.trax_support_reactions(p_user, p_staff, p_tenant, p_admin, p_ticket);
end $$;

-- `mine` is the caller's side and the caller's user: the same login sees its
-- tenant reaction as "theirs" from the platform inbox, and the other way round.
create or replace function public.trax_support_reactions(p_user uuid, p_staff uuid, p_tenant uuid, p_admin boolean, p_ticket uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rows jsonb; side text := case when p_admin then 'support' else 'tenant' end;
begin
  perform public.trax_messaging_guard(p_user, p_staff, p_tenant, p_admin);
  if not exists (
    select 1 from public.trax_support_tickets t
    where t.id = p_ticket and (p_admin or (t.tenant_id = p_tenant and t.user_id = p_user))
  ) then raise exception 'support_access_denied'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('seq', r.message_seq, 'emoji', r.emoji, 'by', r.actor_kind,
      'mine', r.actor_kind = side and r.actor_user = p_user) order by r.created_at), '[]'::jsonb)
    into rows from public.trax_support_message_reactions r where r.ticket_id = p_ticket;
  return rows;
end $$;

revoke all on function public.trax_support_react from public, anon, authenticated;
revoke all on function public.trax_support_reactions from public, anon, authenticated;
grant execute on function public.trax_support_react to service_role;
grant execute on function public.trax_support_reactions to service_role;
