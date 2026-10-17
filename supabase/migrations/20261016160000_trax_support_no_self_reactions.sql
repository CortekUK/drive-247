-- Nobody reacts to their own side's messages: a tenant reacts to support's
-- replies, support to the tenant's. Clearing a reaction stays allowed, so any
-- earlier one can still be taken back.

create or replace function public.trax_support_react(p_user uuid, p_staff uuid, p_tenant uuid, p_admin boolean, p_ticket uuid, p_seq integer, p_emoji text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare side text := case when p_admin then 'support' else 'tenant' end; author text;
begin
  perform public.trax_messaging_guard(p_user, p_staff, p_tenant, p_admin);
  if p_emoji is not null and p_emoji not in ('👍','❤️','😂','😮','🙏') then raise exception 'invalid_support_reaction'; end if;
  -- The same ownership rule as the thread: a tenant reacts only in their own tickets.
  if not exists (
    select 1 from public.trax_support_tickets t
    where t.id = p_ticket and (p_admin or (t.tenant_id = p_tenant and t.user_id = p_user))
  ) then raise exception 'support_access_denied'; end if;
  select m.author_kind into author from public.trax_support_messages m where m.ticket_id = p_ticket and m.seq = p_seq;
  if author is null then raise exception 'invalid_support_reaction'; end if;
  -- Only ever the caller's own reaction, on the caller's own side.
  if p_emoji is null then
    delete from public.trax_support_message_reactions
    where ticket_id = p_ticket and message_seq = p_seq and actor_kind = side and actor_user = p_user;
  else
    if author = side then raise exception 'invalid_support_reaction'; end if;
    insert into public.trax_support_message_reactions (ticket_id, message_seq, actor_kind, actor_user, emoji)
    values (p_ticket, p_seq, side, p_user, p_emoji)
    on conflict (ticket_id, message_seq, actor_kind, actor_user) do update set emoji = excluded.emoji, updated_at = now();
  end if;
  return public.trax_support_reactions(p_user, p_staff, p_tenant, p_admin, p_ticket);
end $$;

revoke all on function public.trax_support_react from public, anon, authenticated;
grant execute on function public.trax_support_react to service_role;
