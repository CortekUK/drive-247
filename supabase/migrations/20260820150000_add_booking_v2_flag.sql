-- Per-tenant switch for the booking-v2 landing design.
--
-- When true, the tenant's booking site serves the booking-v2 landing at `/`
-- instead of the legacy home page. Every other route (/fleet, /booking,
-- /about, the customer portal) is unaffected, so the booking funnel is never
-- touched by this flag.
--
-- Controlled by super admins from the admin app's tenant detail page. Defaults
-- to false so no existing tenant's site changes when this ships; only the
-- `test` tenant, which is what we review the design on, is switched on.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS booking_v2_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.booking_v2_enabled IS
  'When true the tenant''s booking site serves the booking-v2 landing design at / instead of the legacy home page. Super-admin controlled; does not affect any other route.';

UPDATE public.tenants
   SET booking_v2_enabled = true
 WHERE slug = 'test';

-- `anon` holds COLUMN-level SELECT grants on public.tenants, not a table-wide
-- one (234 of 258 columns at time of writing). A new column is therefore
-- invisible to the anon key by default, and Postgres refuses the WHOLE row for
-- any select that mentions it — so without this grant the booking site's
-- TenantContext query fails outright and every tenant silently loses its
-- branding, not just this flag.
--
-- `authenticated` already has a table-level SELECT and needs nothing here.
GRANT SELECT (booking_v2_enabled) ON public.tenants TO anon;
