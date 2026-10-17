-- The Drive247 platform team: who is on it, in which role, and the password a
-- super admin set for them.
--
-- Roles: super_admin | manager | sales | support. Every member signs in to the
-- super admin dashboard as an app_users row with is_super_admin = true (full access
-- for now). The one difference today: only a super_admin may add people, which is
-- carried by app_users.is_primary_super_admin = true (the flag the Manage Admins
-- page and admin-create-* functions already check).
--
-- Passwords: the owner asked to be able to read back each member's password. It is
-- held in Supabase Vault (encrypted at rest), referenced here by secret id, and only
-- ever decrypted by `platform_team_list` — service_role only, called by the
-- admin-team edge function after it has verified the caller is a super_admin. RLS
-- is on with no policies, so neither anon nor authenticated can read this table.
-- If a member later changes their own password, the stored copy is the one set
-- here, not theirs (`password_set_at` says when it was set).

create table if not exists public.platform_team_members (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null unique references public.app_users(id) on delete cascade,
  platform_role text not null check (platform_role in ('super_admin','manager','sales','support')),
  password_secret_id uuid,
  password_set_at timestamptz,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_team_members enable row level security;
revoke all on public.platform_team_members from anon, authenticated;
grant all on public.platform_team_members to service_role;

/** Store (or replace) a member's password in Vault. service_role only. */
create or replace function public.platform_team_set_password(p_app_user uuid, p_password text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare member public.platform_team_members%rowtype; secret uuid;
begin
  select * into member from public.platform_team_members where app_user_id=p_app_user for update;
  if member.id is null then raise exception 'platform_team_member_missing'; end if;
  if member.password_secret_id is not null then
    perform vault.update_secret(member.password_secret_id, p_password);
  else
    secret := vault.create_secret(p_password, 'platform_team_password_'||p_app_user::text, 'Platform team member password (Manage Admins)');
    update public.platform_team_members set password_secret_id=secret where id=member.id;
  end if;
  update public.platform_team_members set password_set_at=now(), updated_at=now() where id=member.id;
end $$;

/** Every active member with their role and stored password. service_role only. */
create or replace function public.platform_team_list()
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',u.id,'email',u.email,'name',u.name,'created_at',u.created_at,
    'is_primary_super_admin',u.is_primary_super_admin,
    'platform_role',coalesce(m.platform_role,case when u.is_primary_super_admin then 'super_admin' end),
    'password',s.decrypted_secret,'password_set_at',m.password_set_at
  ) order by u.created_at desc),'[]')
  from public.app_users u
  left join public.platform_team_members m on m.app_user_id=u.id
  left join vault.decrypted_secrets s on s.id=m.password_secret_id
  where u.is_super_admin and u.is_active and u.tenant_id is null
$$;

revoke all on function public.platform_team_set_password(uuid,text) from public, anon, authenticated;
revoke all on function public.platform_team_list() from public, anon, authenticated;
grant execute on function public.platform_team_set_password(uuid,text) to service_role;
grant execute on function public.platform_team_list() to service_role;
