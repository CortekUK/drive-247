-- External calendar sync (Turo / Airbnb-style iCal imports)
-- Vehicles can point at a public iCal feed; a cron job pulls it and writes blocks
-- into external_bookings. The rentals calendar + conflict checks read from this table
-- to prevent Drive247 from double-booking a vehicle already reserved elsewhere.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS external_ical_url TEXT,
  ADD COLUMN IF NOT EXISTS external_ical_source TEXT,
  ADD COLUMN IF NOT EXISTS external_ical_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS external_ical_last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS external_ical_last_error TEXT;

CREATE TABLE IF NOT EXISTS public.external_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'turo',
  external_uid TEXT NOT NULL,
  summary TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  raw JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, external_uid)
);

CREATE INDEX IF NOT EXISTS idx_external_bookings_tenant ON public.external_bookings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_external_bookings_vehicle_range
  ON public.external_bookings(vehicle_id, start_date, end_date);

ALTER TABLE public.external_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant can read external_bookings" ON public.external_bookings;
CREATE POLICY "tenant can read external_bookings" ON public.external_bookings
  FOR SELECT USING (
    tenant_id = public.get_user_tenant_id() OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "service role manages external_bookings" ON public.external_bookings;
CREATE POLICY "service role manages external_bookings" ON public.external_bookings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Cron: run the sync every 15 minutes. Idempotent re-schedule.
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";

DO $$
BEGIN
  PERFORM cron.unschedule('sync-external-calendars');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'sync-external-calendars',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/sync-external-calendars',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
