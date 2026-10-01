-- Dark-mode square icon for the v2 portal (Settings → Branding → Logos).
--
-- The square icon (`favicon_url`) is drawn for a white page; on the dark
-- sidebar a navy or black mark disappears. This column is the tenant's own
-- dark-mode version of it. Nullable, no default read by v1: when it is NULL
-- the portal falls back to `favicon_url` and, in dark mode, measures that
-- image and gives it a light plate or outline only if it needs one
-- (apps/portal/src/lib/appearance/logo-tone.ts).
--
-- The GRANT is not optional. `anon` holds COLUMN-level SELECT grants on
-- tenants, and Postgres refuses the whole row for any select naming a column
-- the role cannot see — a new column without its grant would take down every
-- booking site's branding the moment something selects it (V2_PLAN §4).
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS dark_favicon_url text;
GRANT SELECT (dark_favicon_url) ON public.tenants TO anon;
