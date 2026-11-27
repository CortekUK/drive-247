-- APPLIED to staging and production 2026-11-27.
--
-- Super admin → Retention → Signups: a follow-up tag and notes on each signup
-- (Bryan's sales team, 2026-11-27: "add notes to a lead as well as a tag such
-- as Contacted - Not interested, Contacted - Undecided or Not reachable, so we
-- could easily filter who we would consider as qualified leads").
--
-- A signup row is either a lead (no account yet) or an account, and a lead
-- becomes an account later under the same email. So both tables are keyed by
-- `signup_key`: the lower-cased email, or 'lead:<signup_leads.id>' for the rare
-- lead with no email. The tag and notes then follow the person from lead to
-- account without moving anything.
--
-- RLS on with no policies: only the SECURITY DEFINER functions below touch
-- these tables, and each one refuses anyone who is not a super admin.

create table if not exists public.signup_followups (
  signup_key text primary key,
  status text not null check (status in (
    'interested', 'undecided', 'not_interested', 'not_reachable'
  )),
  updated_by uuid,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

create table if not exists public.signup_notes (
  id uuid primary key default gen_random_uuid(),
  signup_key text not null,
  body text not null check (length(trim(body)) between 1 and 4000),
  author_id uuid,
  author_email text,
  created_at timestamptz not null default now()
);

create index if not exists signup_notes_key_idx on public.signup_notes (signup_key, created_at desc);

alter table public.signup_followups enable row level security;
alter table public.signup_notes enable row level security;
revoke all on public.signup_followups from anon, authenticated, public;
revoke all on public.signup_notes from anon, authenticated, public;

comment on table public.signup_followups is
  'Admin Signups tab: the follow-up tag per signup (keyed by lower(email) or lead:<id>). Read/written only through admin_signup_* functions.';
comment on table public.signup_notes is
  'Admin Signups tab: dated notes per signup (keyed like signup_followups). Read/written only through admin_signup_* functions.';

-- ── Read: every tag and note, for the page to join onto admin_signups() ──
create or replace function public.admin_signup_followups()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'tags', coalesce((
      select jsonb_object_agg(f.signup_key, jsonb_build_object(
        'status', f.status, 'by', f.updated_by_email, 'at', f.updated_at))
        from signup_followups f), '{}'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'key', n.signup_key, 'body', n.body, 'by', n.author_email, 'at', n.created_at)
        order by n.created_at desc)
        from signup_notes n), '[]'::jsonb)
  );
end;
$function$;

-- ── Set or clear the tag (p_status null = "Not contacted") ──────────────
create or replace function public.admin_signup_set_status(p_key text, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_key text := lower(trim(coalesce(p_key, '')));
begin
  if not public.is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  if v_key = '' then
    raise exception 'Missing signup' using errcode = '22023';
  end if;

  if p_status is null then
    delete from signup_followups where signup_key = v_key;
    return;
  end if;

  insert into signup_followups (signup_key, status, updated_by, updated_by_email, updated_at)
  values (v_key, p_status, auth.uid(), (select email::text from auth.users where id = auth.uid()), now())
  on conflict (signup_key) do update
     set status = excluded.status,
         updated_by = excluded.updated_by,
         updated_by_email = excluded.updated_by_email,
         updated_at = now();
end;
$function$;

-- ── Add a note ──────────────────────────────────────────────────────────
create or replace function public.admin_signup_add_note(p_key text, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_key text := lower(trim(coalesce(p_key, '')));
  v_row signup_notes;
begin
  if not public.is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  if v_key = '' then
    raise exception 'Missing signup' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_body, ''))) = 0 then
    raise exception 'Write a note first' using errcode = '22023';
  end if;

  insert into signup_notes (signup_key, body, author_id, author_email)
  values (v_key, trim(p_body), auth.uid(), (select email::text from auth.users where id = auth.uid()))
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'key', v_row.signup_key, 'body', v_row.body,
                            'by', v_row.author_email, 'at', v_row.created_at);
end;
$function$;

-- ── Delete a note ───────────────────────────────────────────────────────
create or replace function public.admin_signup_delete_note(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  delete from signup_notes where id = p_id;
end;
$function$;

revoke all on function public.admin_signup_followups() from public, anon;
revoke all on function public.admin_signup_set_status(text, text) from public, anon;
revoke all on function public.admin_signup_add_note(text, text) from public, anon;
revoke all on function public.admin_signup_delete_note(uuid) from public, anon;
grant execute on function public.admin_signup_followups() to authenticated;
grant execute on function public.admin_signup_set_status(text, text) to authenticated;
grant execute on function public.admin_signup_add_note(text, text) to authenticated;
grant execute on function public.admin_signup_delete_note(uuid) to authenticated;
