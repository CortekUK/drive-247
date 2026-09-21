-- Let the platform's own Test tenant run the custom booking site, so it can be
-- tried end to end — booking, email verification, Stripe test checkout, portal —
-- before it is switched on for a paying tenant (RBVS and RevTek take LIVE
-- payments; Test is on Stripe test mode).
--
-- This only makes the Super Admin "Booking site design" switch appear for Test.
-- It does NOT turn the custom site on: booking_v2_enabled is left as it is and
-- stays a Super Admin decision. See 20260902140000_custom_site_eligibility.sql.
UPDATE public.tenants
SET custom_site_eligible = true
WHERE slug = 'test';
