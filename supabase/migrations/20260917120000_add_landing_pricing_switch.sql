-- Super-admin switch: show the pricing tier section on drive-247.com.
--
-- The team lead's testing switch (Sep 2026). The public landing page renders its
-- pricing tier section, the entry point to self-serve signup, only while this is
-- on. It is turned on to test the live signup journey on the main domain and off
-- again afterwards, so it defaults to off.
--
-- The landing page reads with the anon key and cannot read admin_settings (its
-- RLS is authenticated-only, and the table holds staff email addresses), so it
-- calls landing_pricing_enabled(), which returns this one boolean and nothing
-- else. Like the table's other global flags it reads "true if any row is true",
-- and the admin switch writes every row.

alter table public.admin_settings
  add column if not exists landing_pricing_enabled boolean not null default false;

comment on column public.admin_settings.landing_pricing_enabled is
  'Super-admin switch (Signup Plans tab): when true, drive-247.com shows the pricing tier section and its self-serve signup entry. Default off; turned on only while testing the live signup journey.';

create or replace function public.landing_pricing_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(bool_or(landing_pricing_enabled), false) from public.admin_settings;
$$;

comment on function public.landing_pricing_enabled() is
  'The one admin_settings value the public landing page may read. admin_settings itself is authenticated-only and holds staff email addresses.';

revoke all on function public.landing_pricing_enabled() from public;
grant execute on function public.landing_pricing_enabled() to anon, authenticated, service_role;

-- Make the API see the new column and function straight away, instead of
-- answering "column does not exist" until its schema cache next refreshes.
notify pgrst, 'reload schema';
