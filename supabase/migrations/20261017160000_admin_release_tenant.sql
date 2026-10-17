-- admin_release_tenant(p_tenant uuid): the last step before a tenant row is
-- deleted. Removes every row that still points at it through a NO ACTION /
-- RESTRICT foreign key — the ones that would refuse the delete.
--
-- admin-delete-tenant clears tenant data from a hand-kept list of tables, and
-- has failed on a table missing from that list more than once (most recently
-- referral_events.tenant_id). This reads the list from the catalog every time
-- instead, so a table added later cannot block a delete.
--
-- Rows are deleted in passes, each table in its own sub-transaction: a table
-- whose rows are still referenced by another (referrals ← referral_events)
-- simply fails that pass and succeeds on the next, once the child has gone.
-- Up to six passes; whatever still refuses is reported, and the tenant delete
-- that follows says which constraint is in the way.
--
-- SECURITY DEFINER, service_role only: called by admin-delete-tenant after its
-- super-admin check. Additive (V2_PLAN §4).

create or replace function public.admin_release_tenant(p_tenant uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  fk record;
  n bigint;
  pass int;
  progress boolean;
  out jsonb := '{}'::jsonb;
  failed jsonb;
begin
  if p_tenant is null then
    return out;
  end if;
  for pass in 1..6 loop
    progress := false;
    failed := '{}'::jsonb;
    for fk in
      select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f'
        and c.confrelid = 'public.tenants'::regclass
        and c.confdeltype in ('a', 'r')
        and array_length(c.conkey, 1) = 1
        and c.conrelid <> 'public.tenants'::regclass
    loop
      begin
        execute format('delete from %s where %I = $1', fk.tbl, fk.col) using p_tenant;
        get diagnostics n = row_count;
        if n > 0 then
          progress := true;
          out := out || jsonb_build_object(fk.tbl::text || '.' || fk.col, n);
        end if;
      exception when others then
        failed := failed || jsonb_build_object(fk.tbl::text || '.' || fk.col, sqlerrm);
      end;
    end loop;
    exit when not progress;
  end loop;
  if failed <> '{}'::jsonb then
    out := out || jsonb_build_object('_failed', failed);
  end if;
  return out;
end $function$;

revoke all on function public.admin_release_tenant(uuid) from public, anon, authenticated;
grant execute on function public.admin_release_tenant(uuid) to service_role;
