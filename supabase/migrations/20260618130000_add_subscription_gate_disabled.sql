-- Global super-admin kill-switch for the subscription blocker.
-- When TRUE, the portal stops showing the "Finish Setup" / subscription-expired
-- blocking dialog to ALL tenants. Subscription status/plans/billing are untouched.
-- Read by the portal (apps/portal/src/hooks/use-subscription-gate-disabled.ts) and
-- toggled by super admins in the admin Settings page.
alter table public.admin_settings
  add column if not exists subscription_gate_disabled boolean not null default false;

comment on column public.admin_settings.subscription_gate_disabled is
  'Super-admin global kill-switch: when true, the portal hides the subscription/setup blocker dialog for all tenants (status/plans/billing unchanged).';
