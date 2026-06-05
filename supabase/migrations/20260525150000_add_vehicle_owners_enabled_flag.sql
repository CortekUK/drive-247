-- Vehicle Owners + Owner Payouts feature flag.
-- Platform-level toggle: defaults OFF for every tenant so the sidebar entries
-- are hidden. Super-admin flips it on per-tenant from the admin app.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS vehicle_owners_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.tenants.vehicle_owners_enabled IS
  'When TRUE the tenant sees the Vehicle Owners + Owner Payouts sidebar items. Default FALSE for all new tenants — enable per tenant via the super-admin tenant detail page.';
