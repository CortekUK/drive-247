-- Lock vehicle documents to the operator's own staff.            (2026-11-06)
--
-- Found by QA sheet 10 (Keys and documents), row 10.15. Before this:
--   * public.vehicle_files had RLS OFF and one policy, USING (true), plus full
--     table grants to anon — so the public key shipped to every booking site
--     could list every tenant's documents (and insert, change, delete rows).
--   * storage bucket `vehicle-files` is private, but its four storage.objects
--     policies were TO public with only `bucket_id = 'vehicle-files'` — so the
--     same public key could download, upload over, or delete any document.
--
-- After: only signed-in staff of the tenant that owns the car (or a super
-- admin) can see or change a document row or file. Service-role callers
-- (edge functions, cleanup jobs) bypass RLS and are unaffected. Nothing on the
-- booking sites reads these (checked: only apps/portal uses them).
--
-- Object names are always `vehicle/<vehicle id>/<random>.<ext>`
-- (hooks/use-vehicle-files.ts), so ownership is read from the car.

create or replace function public.staff_can_access_vehicle_file(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_super_admin()
    or exists (
      select 1
      from public.vehicles v
      where split_part(object_name, '/', 1) = 'vehicle'
        and v.id::text = split_part(object_name, '/', 2)
        and v.tenant_id = public.get_user_tenant_id()
    )
  );
$$;
revoke all on function public.staff_can_access_vehicle_file(text) from public;
grant execute on function public.staff_can_access_vehicle_file(text) to authenticated, anon;

-- The table -----------------------------------------------------------------
drop policy if exists "Allow all operations for app users on vehicle_files" on public.vehicle_files;
create policy "vehicle_files: own tenant staff"
  on public.vehicle_files
  for all
  to authenticated
  using (public.is_super_admin() or tenant_id = public.get_user_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.get_user_tenant_id());
alter table public.vehicle_files enable row level security;
revoke all on public.vehicle_files from anon;

-- The files -----------------------------------------------------------------
drop policy if exists "Users can view vehicle files" on storage.objects;
drop policy if exists "Users can upload vehicle files" on storage.objects;
drop policy if exists "Users can update vehicle files" on storage.objects;
drop policy if exists "Users can delete vehicle files" on storage.objects;

create policy "vehicle-files: staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'vehicle-files' and public.staff_can_access_vehicle_file(name));
create policy "vehicle-files: staff upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'vehicle-files' and public.staff_can_access_vehicle_file(name));
create policy "vehicle-files: staff update" on storage.objects
  for update to authenticated
  using (bucket_id = 'vehicle-files' and public.staff_can_access_vehicle_file(name))
  with check (bucket_id = 'vehicle-files' and public.staff_can_access_vehicle_file(name));
create policy "vehicle-files: staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'vehicle-files' and public.staff_can_access_vehicle_file(name));

-- To undo (restores the old, open behaviour — do not run unless this breaks something):
--   drop policy "vehicle-files: staff read" on storage.objects;   (and the other three)
--   create policy "Users can view vehicle files"   on storage.objects for select to public using (bucket_id = 'vehicle-files');
--   create policy "Users can upload vehicle files" on storage.objects for insert to public with check (bucket_id = 'vehicle-files');
--   create policy "Users can update vehicle files" on storage.objects for update to public using (bucket_id = 'vehicle-files');
--   create policy "Users can delete vehicle files" on storage.objects for delete to public using (bucket_id = 'vehicle-files');
--   alter table public.vehicle_files disable row level security;
--   grant all on public.vehicle_files to anon;
