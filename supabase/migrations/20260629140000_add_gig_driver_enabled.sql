-- Per-tenant toggle for the "Are you a gig driver?" option on the booking page.
-- Default true so existing tenants keep current behaviour; operators can hide it
-- from Settings → General → Features.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS gig_driver_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tenants.gig_driver_enabled IS
  'When false, hides the gig-driver self-identify checkbox on the customer booking page.';
