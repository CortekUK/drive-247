-- platform_team_set_my_password(p_password): keep Manage Admins' stored copy
-- of a team member's password in step when they change it THEMSELVES, from
-- Profile in the super-admin dashboard.
--
-- Manage Admins shows each member the password a super admin set for them
-- (platform_team_members.password_secret_id → Vault). Changing your own
-- password through Supabase Auth alone would leave that copy stale.
--
-- Scoped to the caller: it resolves auth.uid() to their own app_users row and
-- touches nothing else. Someone with no team-member row (they were never added
-- through Manage Admins) is a no-op, not an error. Additive (V2_PLAN §4).

create or replace function public.platform_team_set_my_password(p_password text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare me uuid;
begin
  if p_password is null or length(p_password) < 8 or length(p_password) > 72 then
    raise exception 'password_length';
  end if;
  select u.id into me from public.app_users u where u.auth_user_id = auth.uid();
  if me is null then return; end if;
  if not exists (select 1 from public.platform_team_members where app_user_id = me) then return; end if;
  perform public.platform_team_set_password(me, p_password);
end $function$;

revoke all on function public.platform_team_set_my_password(text) from public, anon;
grant execute on function public.platform_team_set_my_password(text) to authenticated;
