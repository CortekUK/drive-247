-- The custom booking site ships one approved palette for every operator. This
-- column is the single, operator-set exception: a brand accent for that site
-- only, chosen in the portal.
--
-- NULL means "use the approved default", which is what every existing tenant
-- gets — so this ships without changing a single live site.
--
-- Deliberately separate from `primary_color`: that drives the existing booking
-- site and the portal, and reusing it here would drag each operator's whole
-- brand into a template that is meant to stay consistent.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS custom_site_accent_color text;

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_custom_site_accent_color_hex;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_custom_site_accent_color_hex
  CHECK (custom_site_accent_color IS NULL OR custom_site_accent_color ~* '^#[0-9a-f]{6}$');

COMMENT ON COLUMN public.tenants.custom_site_accent_color IS
  'Accent colour for the custom booking site only, as #rrggbb. NULL = approved default.';

-- `anon` holds a COLUMN-LEVEL select grant on this table — an allowlist that
-- deliberately withholds the secret columns (API tokens, password hashes). A
-- new column is therefore invisible to it by default, and, worse, naming an
-- ungranted column makes PostgREST reject the WHOLE select with 42501 — so the
-- booking site would silently lose its entire tenant row, not just this field.
--
-- This colour is public by definition: it is painted on the page.
GRANT SELECT (custom_site_accent_color) ON public.tenants TO anon;

NOTIFY pgrst, 'reload schema';
