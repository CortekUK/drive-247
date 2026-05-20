-- Tenant-level Turo iCal sync.
-- Turo doesn't offer per-listing iCal feeds; only one account-wide URL of the
-- form https://turo.com/reservations/subscribe/ical.ics?driverId=...&key=...
-- that contains every reservation across all of a host's vehicles.
-- We store the URL on the tenant and the sync job matches each VEVENT to a
-- vehicle by reg / make+model from the event SUMMARY.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS turo_ical_url TEXT,
  ADD COLUMN IF NOT EXISTS turo_ical_last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS turo_ical_last_error TEXT;
