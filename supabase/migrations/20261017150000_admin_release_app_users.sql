-- admin_release_app_users(p_ids uuid[]): let a tenant's app_users be deleted.
--
-- Deleting a tenant (admin-delete-tenant) has failed repeatedly on foreign
-- keys to app_users that nobody had listed: audit_logs.actor_id, payments.
-- verified_by, cms_pages.published_by and ~30 more, all NO ACTION. Every
-- hand-kept list went stale the next time someone added an "…_by" column.
--
-- So this reads the list from the catalog instead, each time it runs: for
-- every NO ACTION / RESTRICT foreign key that points at public.app_users, it
-- empties the column on rows that point at one of p_ids — or, where the column
-- is NOT NULL, deletes those rows (they cannot exist without that user). Then
-- the app_users rows can go.
--
-- SECURITY DEFINER, service_role only: called by admin-delete-tenant, which
-- has already checked the caller is a super admin. Additive (V2_PLAN §4).

create or replace function public.admin_release_app_users(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  fk record;
  n bigint;
  out jsonb := '{}'::jsonb;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return out;
  end if;
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col, a.attnotnull as notnull
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and c.confrelid = 'public.app_users'::regclass
      and c.confdeltype in ('a', 'r')
      and array_length(c.conkey, 1) = 1
  loop
    if fk.notnull then
      execute format('delete from %s where %I = any ($1)', fk.tbl, fk.col) using p_ids;
    else
      execute format('update %s set %I = null where %I = any ($1)', fk.tbl, fk.col, fk.col) using p_ids;
    end if;
    get diagnostics n = row_count;
    if n > 0 then
      out := out || jsonb_build_object(fk.tbl::text || '.' || fk.col, n);
    end if;
  end loop;
  return out;
end $function$;

revoke all on function public.admin_release_app_users(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_release_app_users(uuid[]) to service_role;
