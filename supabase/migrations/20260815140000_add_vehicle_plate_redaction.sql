-- Plate hiding (Douglas Barboza / DB Car Rentals) — schema catch-up.
--
-- These objects were applied directly to production while the feature was being
-- built and never written down, so staging and any fresh environment lacked
-- them. That is not cosmetic: apps/booking selects redacted_url and
-- redaction_status in the customer rental queries, and PostgREST fails the WHOLE
-- query with 42703 when one selected column is missing — so the customer
-- bookings pages render an error state on every environment except production.
--
-- Everything here is IF NOT EXISTS / guarded, so re-applying against production
-- (which already has all of it) is a no-op.

-- Tenant switch: hides the plate in text AND unlocks the per-photo blur button.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS hide_vehicle_registration boolean NOT NULL DEFAULT false;

-- `anon` holds column-level grants on tenants, so a new column that any public
-- booking query selects must be granted explicitly. Without this the branding
-- read 403s as a whole and every tenant's site falls back to default styling.
GRANT SELECT (hide_vehicle_registration) ON public.tenants TO anon;

ALTER TABLE public.vehicle_photos
  ADD COLUMN IF NOT EXISTS redacted_url text,
  ADD COLUMN IF NOT EXISTS original_url text,
  ADD COLUMN IF NOT EXISTS redaction_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS redaction_regions jsonb,
  ADD COLUMN IF NOT EXISTS redacted_at timestamptz,
  ADD COLUMN IF NOT EXISTS redacted_by uuid;

DO $$
BEGIN
  ALTER TABLE public.vehicle_photos
    ADD CONSTRAINT vehicle_photos_redaction_status_check
    CHECK (redaction_status = ANY (ARRAY['none', 'redacted', 'no_plate']));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- A row claiming to be redacted must carry both the blurred copy that gets
-- served and the original it was derived from; otherwise "redacted" would be a
-- label with nothing behind it and the customer would still see the plate.
DO $$
BEGIN
  ALTER TABLE public.vehicle_photos
    ADD CONSTRAINT vehicle_photos_redacted_needs_url
    CHECK (
      redaction_status <> 'redacted'
      OR (redacted_url IS NOT NULL AND original_url IS NOT NULL)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.vehicle_photos.redacted_url IS
  'Blurred copy served to customers when the tenant hides plates. See customerPhotoUrl() in apps/booking/src/lib/vehicle-identity.ts.';
COMMENT ON COLUMN public.vehicle_photos.original_url IS
  'The pre-redaction image, retained so a redaction can be redone or reverted.';
