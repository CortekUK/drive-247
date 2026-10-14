-- Super-admin switch: which version of the drive-247.com landing page is live.
--
-- 'v1' is the current landing page; 'v2' is the redesign being built beside it.
-- The super admin flips between them from the Signup Plans tab. Defaults to
-- 'v1', so nothing changes for the public until someone switches.
--
-- Same shape as landing_pricing_enabled: the landing page reads with the anon
-- key and never touches admin_settings (staff-only, holds staff emails); it
-- calls landing_version(), which returns this one value. admin_settings has
-- several rows, the admin switch writes every row, and the read is "v2 if any
-- row says v2".

alter table public.admin_settings
  add column if not exists landing_version text not null default 'v1';

alter table public.admin_settings
  drop constraint if exists admin_settings_landing_version_check;
alter table public.admin_settings
  add constraint admin_settings_landing_version_check check (landing_version in ('v1', 'v2'));

comment on column public.admin_settings.landing_version is
  'Super-admin switch (Signup Plans tab): which drive-247.com landing page is live, v1 (current) or v2 (redesign). Default v1.';

create or replace function public.landing_version()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when bool_or(landing_version = 'v2') then 'v2' else 'v1' end from public.admin_settings;
$$;

comment on function public.landing_version() is
  'The landing-page version the public site may read. admin_settings itself is authenticated-only and holds staff email addresses.';

revoke all on function public.landing_version() from public;
grant execute on function public.landing_version() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
