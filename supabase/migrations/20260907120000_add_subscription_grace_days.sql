-- The payment grace period, moved out of the portal's source and into config.
--
-- `use-tenant-subscription.ts` carried `const GRACE_DAYS = 7`: the number of
-- days a tenant keeps access after a subscription payment fails, before the
-- blocking dialog. That is the moment a paying business loses its own bookings,
-- and changing it required a deploy.
--
-- It now sits beside `subscription_gate_disabled` in admin_settings, which the
-- super admin dashboard already edits (oldest row, mirrored to the rest) and
-- which any authenticated user may SELECT. The portal reads it in
-- use-subscription-grace-days.ts and falls back to 7 whenever the read fails,
-- so a config outage can never shorten anybody's window.
alter table public.admin_settings
  add column if not exists subscription_grace_days integer not null default 7;

alter table public.admin_settings
  drop constraint if exists admin_settings_grace_days_sane;

-- 0 is legitimate (block immediately); 90 is a ceiling against a typo that
-- would silently disable the blocker for a quarter of a year.
alter table public.admin_settings
  add constraint admin_settings_grace_days_sane
  check (subscription_grace_days between 0 and 90);

comment on column public.admin_settings.subscription_grace_days is
  'Days a tenant keeps access after a subscription payment fails or an invoice goes unpaid, before the blocking dialog. Read by the portal (use-subscription-grace-days.ts) and set by super admins. 0 = block immediately.';
