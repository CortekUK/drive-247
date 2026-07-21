-- =============================================================================
-- Fix: tenants.app_name defaulted to the LITERAL string 'Drive 917'.
--
-- Every consumer does `app_name || company_name || 'Drive247'`, but because the
-- column was populated with a non-NULL default, that fallback could never fire —
-- so any tenant who never set a name renders the Drive247 platform brand as
-- their own wordmark (portal sidebar, <title>, og:site_name, login page).
--
-- 1. Drop the default so newly created tenants get NULL and the fallback works.
-- 2. Backfill existing tenants that are still sitting on the default.
--
-- Only rows still holding the platform default (or NULL) are touched, so a
-- tenant who deliberately set their own app_name is left alone.
-- Idempotent.
-- =============================================================================

ALTER TABLE public.tenants ALTER COLUMN app_name DROP DEFAULT;

UPDATE public.tenants
SET app_name = company_name
WHERE (app_name IS NULL OR app_name = 'Drive 917')
  AND company_name IS NOT NULL
  AND btrim(company_name) <> '';
