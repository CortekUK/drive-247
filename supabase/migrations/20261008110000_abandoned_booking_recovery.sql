-- APPLIED to production 2026-10-08 via the Management API; cron `abandoned-recovery-run` (*/10) scheduled.
--
-- Abandoned booking recovery: V1 and V2 booking sites.
--
-- A renter who starts a booking and leaves halfway gets one AI-written
-- follow-up email ("Still want the Tesla for Saturday–Sunday? Finish here.").
-- If they reply with a question, the AI answers using ONLY that tenant's
-- approved FAQs (public.faqs, is_active). Super admins watch it all under
-- Customer management → Abandoned Recovery.
--
--   abandoned_recovery_settings  singleton: on/off, delay, which tenants
--   abandoned_bookings           one row per booking session (browser), upserted
--                                by the public `abandoned-booking-track` function
--                                as the renter moves through the steps
--   abandoned_recovery_messages  the conversation: recovery email, questions
--                                the renter replied with, the AI's answers
--
-- Runner: `abandoned-recovery-run` every 10 minutes (cron applied separately so
-- the service key never lands in this file). Replies: `abandoned-recovery-inbound`.
-- Nothing here is readable or writable by anon — the booking sites write through
-- the edge function, which uses the service role.

CREATE TABLE IF NOT EXISTS public.abandoned_recovery_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  delay_minutes integer NOT NULL DEFAULT 60 CHECK (delay_minutes BETWEEN 15 AND 10080),
  auto_reply_enabled boolean NOT NULL DEFAULT true,
  tenant_scope text NOT NULL DEFAULT 'selected' CHECK (tenant_scope IN ('all', 'selected')),
  tenant_ids uuid[] NOT NULL DEFAULT '{}',
  ai_instructions text NOT NULL DEFAULT '' CHECK (char_length(ai_instructions) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.abandoned_recovery_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.abandoned_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id text NOT NULL CHECK (char_length(session_id) BETWEEN 8 AND 80),
  site text NOT NULL CHECK (site IN ('v1', 'v2')),
  -- furthest step reached: dates < vehicle < insurance < details < checkout < payment
  stage text NOT NULL CHECK (stage IN ('dates', 'vehicle', 'insurance', 'details', 'checkout', 'payment', 'completed')),
  stage_rank smallint NOT NULL DEFAULT 0,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  vehicle_name text,
  pickup_date text,
  pickup_time text,
  dropoff_date text,
  dropoff_time text,
  pickup_location text,
  customer_name text,
  customer_email text,
  customer_phone text,
  estimated_total numeric,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  --   in_progress  renter active within the delay window
  --   abandoned    left without finishing; no email (see email_status/email_detail)
  --   emailed      recovery email sent, not (yet) converted
  --   converted    finished the booking (converted_after_email = recovered by us)
  --   expired      30 days on, never finished
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'abandoned', 'emailed', 'converted', 'expired')),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  abandoned_at timestamptz,
  email_status text CHECK (email_status IN ('sent', 'failed', 'skipped')),
  email_detail text,
  email_subject text,
  email_body text,
  email_sent_at timestamptz,
  recovery_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  unsubscribed_at timestamptz,
  converted_at timestamptz,
  converted_rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  converted_after_email boolean NOT NULL DEFAULT false,
  reply_count integer NOT NULL DEFAULT 0,
  last_reply_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT abandoned_bookings_session_unique UNIQUE (tenant_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_abandoned_bookings_open ON public.abandoned_bookings (status, last_activity_at)
  WHERE status IN ('in_progress', 'abandoned', 'emailed');
CREATE INDEX IF NOT EXISTS idx_abandoned_bookings_started ON public.abandoned_bookings (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_abandoned_bookings_email ON public.abandoned_bookings (tenant_id, lower(customer_email));

CREATE TABLE IF NOT EXISTS public.abandoned_recovery_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  abandoned_booking_id uuid NOT NULL REFERENCES public.abandoned_bookings(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  kind text NOT NULL CHECK (kind IN ('recovery', 'question', 'answer')),
  subject text,
  body text NOT NULL,
  -- answers only: did the FAQs cover the question? which FAQ rows were used?
  answered_from_faqs boolean,
  faq_ids uuid[],
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'received', 'skipped')),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_abandoned_recovery_messages_booking ON public.abandoned_recovery_messages (abandoned_booking_id, created_at);

ALTER TABLE public.abandoned_recovery_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abandoned_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abandoned_recovery_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admins manage abandoned recovery settings" ON public.abandoned_recovery_settings;
CREATE POLICY "super admins manage abandoned recovery settings" ON public.abandoned_recovery_settings
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "super admins read abandoned bookings" ON public.abandoned_bookings;
CREATE POLICY "super admins read abandoned bookings" ON public.abandoned_bookings
  FOR SELECT TO authenticated USING (public.is_super_admin());

DROP POLICY IF EXISTS "super admins read abandoned recovery messages" ON public.abandoned_recovery_messages;
CREATE POLICY "super admins read abandoned recovery messages" ON public.abandoned_recovery_messages
  FOR SELECT TO authenticated USING (public.is_super_admin());

-- Which open sessions turned into a real booking? A rental counts once it is
-- paid (or refunded, so it was paid) or approved — an unpaid draft does not.
-- Matched on the rental the session created, or on any rental the same email
-- made at that tenant after the session started.
CREATE OR REPLACE FUNCTION public.abandoned_bookings_find_conversions(p_ids uuid[])
RETURNS TABLE (abandoned_id uuid, rental_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (a.id) a.id, r.id
  FROM abandoned_bookings a
  JOIN rentals r ON r.tenant_id = a.tenant_id
  WHERE a.id = ANY(p_ids)
    AND (r.payment_status IN ('fulfilled', 'refunded') OR r.approval_status = 'approved')
    AND (
      r.id = a.rental_id
      OR (
        a.customer_email IS NOT NULL
        AND r.created_at >= a.started_at - interval '10 minutes'
        AND r.customer_id IN (
          SELECT c.id FROM customers c
          WHERE c.tenant_id = a.tenant_id AND lower(c.email) = lower(a.customer_email)
        )
      )
    )
  ORDER BY a.id, (r.id = a.rental_id) DESC, r.created_at;
$$;
REVOKE ALL ON FUNCTION public.abandoned_bookings_find_conversions(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abandoned_bookings_find_conversions(uuid[]) TO service_role;
-- Runner: cron.schedule('abandoned-recovery-run', '*/10 * * * *', <net.http_post to /functions/v1/abandoned-recovery-run with the service-role bearer>), applied separately.
