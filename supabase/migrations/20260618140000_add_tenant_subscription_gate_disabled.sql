-- Per-tenant override for the subscription blocker.
-- When TRUE, this specific tenant is never shown the "Finish Setup" /
-- subscription-expired blocking dialog (status/plans/billing unchanged).
-- Combined (OR) with the global admin_settings.subscription_gate_disabled switch.
-- Toggled by super admins on the tenant detail Subscription card; read by the
-- portal via TenantContext.
alter table public.tenants
  add column if not exists subscription_gate_disabled boolean not null default false;

comment on column public.tenants.subscription_gate_disabled is
  'Per-tenant override: when true, this tenant is not shown the subscription/setup blocker dialog (status/plans/billing unchanged). OR-combined with admin_settings.subscription_gate_disabled.';
