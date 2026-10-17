-- The platform's own email sender, set on the super admin's Notifications ›
-- Setups › Email sender (the twin of the portal's tenant_email_sender).
-- Additive: three nullable columns; NULL = the default, "Drive 247 <noreply@drive-247.com>".
alter table public.admin_settings
  add column if not exists platform_sender_name text,
  add column if not exists platform_sender_local_part text,
  add column if not exists platform_reply_to text;

alter table public.admin_settings
  drop constraint if exists admin_settings_platform_sender_local_part_check;
alter table public.admin_settings
  add constraint admin_settings_platform_sender_local_part_check
  check (platform_sender_local_part is null or platform_sender_local_part ~ '^[a-z0-9][a-z0-9._-]{0,63}$');
