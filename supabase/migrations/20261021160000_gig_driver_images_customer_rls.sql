-- Customers manage their OWN gig driver proof (customer portal v2 → Settings →
-- Gig driver). Until now only staff (get_user_tenant_id) and anon had
-- policies, so a signed-in customer could upload the file to the bucket but
-- not read, file or delete its `gig_driver_images` row — every upload showed
-- as "not reached the company" and earlier ones never listed.
-- Ownership is the customer_users link for the row's own tenant.

drop policy if exists "Customers read own gig driver images" on public.gig_driver_images;
create policy "Customers read own gig driver images" on public.gig_driver_images
  for select to authenticated
  using (exists (
    select 1 from public.customer_users cu
    where cu.customer_id = gig_driver_images.customer_id
      and cu.tenant_id = gig_driver_images.tenant_id
      and cu.auth_user_id = auth.uid()
  ));

drop policy if exists "Customers add own gig driver images" on public.gig_driver_images;
create policy "Customers add own gig driver images" on public.gig_driver_images
  for insert to authenticated
  with check (exists (
    select 1 from public.customer_users cu
    where cu.customer_id = gig_driver_images.customer_id
      and cu.tenant_id = gig_driver_images.tenant_id
      and cu.auth_user_id = auth.uid()
  ));

drop policy if exists "Customers delete own gig driver images" on public.gig_driver_images;
create policy "Customers delete own gig driver images" on public.gig_driver_images
  for delete to authenticated
  using (exists (
    select 1 from public.customer_users cu
    where cu.customer_id = gig_driver_images.customer_id
      and cu.tenant_id = gig_driver_images.tenant_id
      and cu.auth_user_id = auth.uid()
  ));
