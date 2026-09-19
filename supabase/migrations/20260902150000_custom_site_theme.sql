-- Optional per-tenant overrides for the custom site's palette.
--
-- `custom_site_accent_color` already carries the one colour an operator picks
-- for themselves, and every other shade is derived from it. This column is for
-- the cases where a brand specifies its grounds too — a particular midnight for
-- the footer, a particular dark surface — which cannot be derived from an
-- accent without guessing.
--
-- Keys, all optional: soft, deep, surfaceDark. NULL, or an absent key, keeps
-- the derived or approved value, so this changes nothing for anyone until it
-- is set.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS custom_site_theme jsonb;

COMMENT ON COLUMN public.tenants.custom_site_theme IS
  'Optional custom-site palette overrides: {"soft","deep","surfaceDark"} as #rrggbb. NULL = derive from the accent.';

GRANT SELECT (custom_site_theme) ON public.tenants TO anon;

NOTIFY pgrst, 'reload schema';
