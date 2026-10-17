-- Reactions on Support messages: one emoji per person per message, from a fixed
-- set of five. Read and written only through the two functions below, by the
-- `trax-messaging` edge function (service_role), after the same access checks as
-- the thread itself. No RLS policies on purpose: nothing else may touch the table.

create table public.trax_support_message_reactions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.trax_support_tickets(id) on delete cascade,
  message_seq integer not null,
  actor_kind text not null check (actor_kind in ('tenant','support')),
  actor_user uuid not null,
  emoji text not null check (emoji in ('👍','❤️','😂','😮','🙏')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One reaction per person per message: reacting again replaces it.
  unique (ticket_id, message_seq, actor_user)
);
create index trax_support_message_reactions_ticket on public.trax_support_message_reactions (ticket_id);

alter table public.trax_support_message_reactions enable row level security;
revoke all on public.trax_support_message_reactions from public, anon, authenticated;
grant all on public.trax_support_message_reactions to service_role;

-- Set, replace or clear (p_emoji null) the caller's reaction on one message.
-- Returns the ticket's reactions, as trax_support_reactions does.
create function public.trax_support_react(p_user uuid, p_staff uuid, p_tenant uuid, p_admin boolean, p_ticket uuid, p_seq integer, p_emoji text)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  if p_emoji is null then
    delete from public.trax_support_message_reactions where ticket_id = p_ticket and message_seq = p_seq and actor_user = p_user;
  else
    insert into public.trax_support_message_reactions (ticket_id, message_seq, actor_kind, actor_user, emoji)
    values (p_ticket, p_seq, case when p_admin then 'support' else 'tenant' end, p_user, p_emoji)
    on conflict (ticket_id, message_seq, actor_user) do update set emoji = excluded.emoji, updated_at = now();
  end if;
  return public.trax_support_reactions(p_user, p_staff, p_tenant, p_admin, p_ticket);
end $$;

-- A ticket's reactions: [{seq, emoji, by: 'tenant'|'support', mine}]. Never who
-- else by id — only which side reacted, and whether it was the caller.
create function public.trax_support_reactions(p_user uuid, p_staff uuid, p_tenant uuid, p_admin boolean, p_ticket uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rows jsonb;
begin
  perform public.trax_messaging_guard(p_user, p_staff, p_tenant, p_admin);
  if not exists (
    select 1 from public.trax_support_tickets t
    where t.id = p_ticket and (p_admin or (t.tenant_id = p_tenant and t.user_id = p_user))
  ) then raise exception 'support_access_denied'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('seq', r.message_seq, 'emoji', r.emoji, 'by', r.actor_kind, 'mine', r.actor_user = p_user) order by r.created_at), '[]'::jsonb)
    into rows from public.trax_support_message_reactions r where r.ticket_id = p_ticket;
  return rows;
end $$;

revoke all on function public.trax_support_react from public, anon, authenticated;
revoke all on function public.trax_support_reactions from public, anon, authenticated;
grant execute on function public.trax_support_react to service_role;
grant execute on function public.trax_support_reactions to service_role;
