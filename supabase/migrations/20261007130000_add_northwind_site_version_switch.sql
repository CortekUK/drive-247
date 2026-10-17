-- Super-admin switch: which version of NORTHWIND's booking site is live.
--
-- 'v1' is Northwind's current booking site (apps/booking (northwind)/northwind-site);
-- 'v2' is the redesign being built beside it ((northwind-v2)/northwind-site-v2).
-- Flipped from the super admin's Developer tab. Defaults to 'v1', and only
-- tenants in NEW_DESIGN_TENANTS (apps/booking/src/lib/booking-design.ts) ever
-- read it, so no other tenant's site can change.
--
-- Same shape as landing_version: the booking middleware reads with the anon
-- key and never touches admin_settings (staff-only, holds staff emails); it
-- calls northwind_site_version(), which returns this one value. admin_settings
-- has several rows, the admin switch writes every row, and the read is "v2 if
-- any row says v2".

alter table public.admin_settings
  add column if not exists northwind_site_version text not null default 'v1';

alter table public.admin_settings
  drop constraint if exists admin_settings_northwind_site_version_check;
alter table public.admin_settings
  add constraint admin_settings_northwind_site_version_check check (northwind_site_version in ('v1', 'v2'));

comment on column public.admin_settings.northwind_site_version is
  'Super-admin switch (Developer tab): which Northwind booking site is live, v1 (current) or v2 (redesign). Default v1.';

create or replace function public.northwind_site_version()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when bool_or(northwind_site_version = 'v2') then 'v2' else 'v1' end from public.admin_settings;
$$;

comment on function public.northwind_site_version() is
  'The Northwind booking-site version the booking middleware may read. admin_settings itself is authenticated-only and holds staff email addresses.';

revoke all on function public.northwind_site_version() from public;
grant execute on function public.northwind_site_version() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
