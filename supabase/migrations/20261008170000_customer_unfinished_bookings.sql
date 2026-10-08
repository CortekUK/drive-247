-- The customer portal's "Continue your booking": a signed-in customer's own
-- unfinished bookings on this tenant's site, each with the link that reopens it
-- (the same ?resume=<recovery_token> link the recovery email carries).
--
-- abandoned_bookings stays readable by super admins only; this is the one,
-- narrow way in for a customer. A row is theirs when its email is their
-- account's email (the JWT's, which Supabase only issues once confirmed) and
-- they are a customer of that tenant. Returns the car, dates and step only —
-- not the name, phone or anything else typed into the form.
CREATE OR REPLACE FUNCTION public.customer_unfinished_bookings(p_tenant_id uuid)
RETURNS TABLE (
  id uuid,
  site text,
  stage text,
  vehicle_id uuid,
  vehicle_name text,
  pickup_date text,
  dropoff_date text,
  last_activity_at timestamptz,
  resume_path text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    a.id,
    a.site,
    a.stage,
    a.vehicle_id,
    a.vehicle_name,
    a.pickup_date,
    a.dropoff_date,
    a.last_activity_at,
    -- Mirrors resumeUrl() in supabase/functions/_shared/abandoned-recovery.ts.
    CASE
      WHEN a.site = 'v2' AND a.vehicle_id IS NOT NULL THEN '/booking/' || a.vehicle_id || '?resume=' || a.recovery_token
      WHEN t.booking_v2_enabled AND t.custom_site_eligible THEN '/custom-booking-page/book?resume=' || a.recovery_token
      ELSE '/?resume=' || a.recovery_token
    END
  FROM abandoned_bookings a
  JOIN tenants t ON t.id = a.tenant_id
  WHERE a.tenant_id = p_tenant_id
    AND auth.uid() IS NOT NULL
    AND coalesce(auth.jwt() ->> 'email', '') <> ''
    AND lower(a.customer_email) = lower(auth.jwt() ->> 'email')
    AND EXISTS (
      SELECT 1 FROM customer_users cu
      WHERE cu.auth_user_id = auth.uid() AND cu.tenant_id = p_tenant_id
    )
    -- Open sessions only: a completed booking is in their rentals already.
    AND a.status IN ('in_progress', 'abandoned', 'emailed')
    -- The resume link stops working after 30 days (abandoned-booking-track).
    AND a.started_at > now() - interval '30 days'
    -- Something worth continuing: at least a car or dates were chosen.
    AND (a.vehicle_id IS NOT NULL OR a.pickup_date IS NOT NULL)
  ORDER BY a.last_activity_at DESC
  LIMIT 5;
$$;

REVOKE ALL ON FUNCTION public.customer_unfinished_bookings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_unfinished_bookings(uuid) TO authenticated;
