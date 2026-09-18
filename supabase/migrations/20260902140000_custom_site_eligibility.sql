-- Who may run the custom booking site, and who may turn it on.
--
-- `booking_v2_enabled` is the existing per-tenant switch in Super Admin. It is
-- reused here rather than replaced, so no new toggle appears and no tenant's
-- current value changes meaning. What is new is that the switch is now gated:
--
--   custom_site_eligible = false  → the switch cannot be turned on at all
--   custom_site_eligible = true   → a SUPER ADMIN may turn it on
--
-- Both rules are enforced in the database, not just hidden in the admin UI, so
-- a direct PostgREST call from a tenant's own session cannot opt them in.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS custom_site_eligible boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.custom_site_eligible IS
  'Whether this tenant is allowed to run the custom booking site. Set by the platform, not by the tenant.';

CREATE OR REPLACE FUNCTION public.guard_custom_site_toggle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only interested in the switch actually moving.
  IF NEW.booking_v2_enabled IS NOT DISTINCT FROM OLD.booking_v2_enabled THEN
    RETURN NEW;
  END IF;

  -- Guard only what arrives from a browser session. A migration, a job or an
  -- edge function running as service_role is the platform acting on itself and
  -- must stay able to turn the switch off during a rollback.
  IF COALESCE(auth.role(), '') NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can change the booking site design'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.booking_v2_enabled AND NOT COALESCE(NEW.custom_site_eligible, false) THEN
    RAISE EXCEPTION 'This tenant is not enabled for the custom booking site'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_custom_site_toggle ON public.tenants;
CREATE TRIGGER trg_guard_custom_site_toggle
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_custom_site_toggle();

-- Eligibility itself is platform-controlled: nobody but service_role writes it.
REVOKE UPDATE (custom_site_eligible) ON public.tenants FROM anon, authenticated;

-- The booking site reads the switch anonymously to decide which home page to
-- serve. `anon` holds a column-level allowlist on this table, so the column has
-- to be named explicitly or the whole select fails with 42501.
GRANT SELECT (custom_site_eligible) ON public.tenants TO anon;

-- The two tenants piloting the custom site, matched on their real slugs.
UPDATE public.tenants
SET custom_site_eligible = true
WHERE slug IN ('rbvs', 'revtekrentals');

NOTIFY pgrst, 'reload schema';

-- The switch previously meant "serve the booking-v2 prototype", a feature that
-- has since been deleted. Any tenant left holding it on would now silently be
-- moved onto the custom site, so the stale values are cleared for everyone who
-- is not eligible. The trigger is bypassed here by design: this runs as the
-- platform, and it only ever turns the switch OFF.
UPDATE public.tenants
SET booking_v2_enabled = false
WHERE booking_v2_enabled = true AND custom_site_eligible = false;
