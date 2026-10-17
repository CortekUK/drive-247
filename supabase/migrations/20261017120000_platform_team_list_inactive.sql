-- Manage Admins: deactivated team members stay on the list (so they can be
-- reactivated). Only rows that are on the team (platform_team_members) come back
-- when inactive — super admins removed before the team existed stay hidden.
create or replace function public.platform_team_list()
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',u.id,'email',u.email,'name',u.name,'created_at',u.created_at,'is_active',u.is_active,
    'is_primary_super_admin',u.is_primary_super_admin,
    'platform_role',coalesce(m.platform_role,case when u.is_primary_super_admin then 'super_admin' end),
    'password',s.decrypted_secret,'password_set_at',m.password_set_at
  ) order by u.is_active desc, u.created_at desc),'[]')
  from public.app_users u
  left join public.platform_team_members m on m.app_user_id=u.id
  left join vault.decrypted_secrets s on s.id=m.password_secret_id
  where u.is_super_admin and u.tenant_id is null and (u.is_active or m.id is not null)
$$;
revoke all on function public.platform_team_list() from public, anon, authenticated;
grant execute on function public.platform_team_list() to service_role;
