-- Strategy-call booking lifecycle and privacy-safe confirmation funnel.
--
-- This migration is deliberately additive. The legacy qualifier/email rows are
-- retained, while all new browser access is mediated by server-only code.

ALTER TABLE public.contact_requests
  ADD COLUMN IF NOT EXISTS main_booking_source text;

DO $$
BEGIN
  ALTER TABLE public.contact_requests
    ADD CONSTRAINT contact_requests_main_booking_source_valid
    CHECK (
      main_booking_source IS NULL OR main_booking_source = ANY (ARRAY[
        'Turo', 'Instagram / Facebook', 'Website', 'Referrals', 'Google', 'Other'
      ])
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.strategy_call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_request_id uuid NOT NULL
    REFERENCES public.contact_requests(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  submission_rate_key text NOT NULL,
  status text NOT NULL DEFAULT 'qualified'
    CHECK (status IN ('qualified', 'calendar_opened', 'booked', 'cancelled', 'expired')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_call_session_token_hash_valid
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT strategy_call_session_rate_key_valid
    CHECK (submission_rate_key ~ '^[0-9a-f]{64}$'),
  UNIQUE (contact_request_id)
);

CREATE INDEX IF NOT EXISTS idx_strategy_call_sessions_expiry
  ON public.strategy_call_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_strategy_call_sessions_submission_rate
  ON public.strategy_call_sessions (submission_rate_key, created_at DESC);

DROP TRIGGER IF EXISTS strategy_call_sessions_set_updated_at
  ON public.strategy_call_sessions;
CREATE TRIGGER strategy_call_sessions_set_updated_at
  BEFORE UPDATE ON public.strategy_call_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.strategy_call_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.strategy_call_sessions(id) ON DELETE SET NULL,
  contact_request_id uuid NOT NULL
    REFERENCES public.contact_requests(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'ghl' CHECK (provider IN ('ghl')),
  external_booking_id text NOT NULL,
  external_calendar_id text,
  external_contact_id text,
  status text NOT NULL
    CHECK (status IN ('scheduled', 'rescheduled', 'cancelled', 'completed', 'no_show')),
  scheduled_start_at timestamptz NOT NULL,
  scheduled_end_at timestamptz NOT NULL,
  booking_timezone text,
  reschedule_url text,
  cancel_url text,
  meeting_url text,
  booked_at timestamptz NOT NULL DEFAULT now(),
  last_provider_event_at timestamptz NOT NULL,
  last_provider_event_id text,
  last_provider_event_was_schedule_change boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_call_external_booking_id_valid
    CHECK (char_length(external_booking_id) BETWEEN 1 AND 255),
  CONSTRAINT strategy_call_external_calendar_id_valid
    CHECK (external_calendar_id IS NULL OR char_length(external_calendar_id) BETWEEN 1 AND 255),
  CONSTRAINT strategy_call_booking_time_valid
    CHECK (scheduled_end_at > scheduled_start_at),
  UNIQUE (provider, external_booking_id)
);

CREATE INDEX IF NOT EXISTS idx_strategy_call_bookings_contact
  ON public.strategy_call_bookings (contact_request_id, scheduled_start_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_call_bookings_session
  ON public.strategy_call_bookings (session_id, scheduled_start_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_call_bookings_upcoming
  ON public.strategy_call_bookings (scheduled_start_at)
  WHERE status IN ('scheduled', 'rescheduled');

DROP TRIGGER IF EXISTS strategy_call_bookings_set_updated_at
  ON public.strategy_call_bookings;
CREATE TRIGGER strategy_call_bookings_set_updated_at
  BEFORE UPDATE ON public.strategy_call_bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- A delivery ledger makes webhook retries observable without retaining the raw
-- provider payload (which can contain PII).
CREATE TABLE IF NOT EXISTS public.strategy_call_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'ghl' CHECK (provider IN ('ghl')),
  provider_event_id text NOT NULL,
  external_booking_id text NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('scheduled', 'rescheduled', 'cancelled', 'completed', 'no_show')),
  provider_occurred_at timestamptz NOT NULL,
  processing_status text NOT NULL DEFAULT 'processing'
    CHECK (processing_status IN ('processing', 'processed', 'ignored', 'unmatched', 'failed')),
  booking_id uuid REFERENCES public.strategy_call_bookings(id) ON DELETE SET NULL,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  failure_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_call_webhook_provider_event_id_valid
    CHECK (char_length(provider_event_id) BETWEEN 1 AND 255),
  CONSTRAINT strategy_call_webhook_external_booking_id_valid
    CHECK (char_length(external_booking_id) BETWEEN 1 AND 255),
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_strategy_call_webhook_events_status
  ON public.strategy_call_webhook_events (processing_status, received_at DESC);

DROP TRIGGER IF EXISTS strategy_call_webhook_events_set_updated_at
  ON public.strategy_call_webhook_events;
CREATE TRIGGER strategy_call_webhook_events_set_updated_at
  BEFORE UPDATE ON public.strategy_call_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Link the existing email lifecycle to the authoritative booking and make each
-- send/schedule attempt independently idempotent (including reschedules).
ALTER TABLE public.strategy_call_emails
  ADD COLUMN IF NOT EXISTS booking_id uuid
    REFERENCES public.strategy_call_bookings(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS suppressed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS provider_message_id text;

UPDATE public.strategy_call_emails
SET delivery_status = CASE WHEN sent_at IS NULL THEN 'pending' ELSE 'sent' END
WHERE delivery_status IS DISTINCT FROM
  CASE WHEN sent_at IS NULL THEN 'pending' ELSE 'sent' END;

UPDATE public.strategy_call_emails
SET idempotency_key = 'legacy:' || id::text
WHERE idempotency_key IS NULL;

ALTER TABLE public.strategy_call_emails
  ALTER COLUMN idempotency_key SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.strategy_call_emails
    ADD CONSTRAINT strategy_call_emails_delivery_status_valid
    CHECK (delivery_status IN ('pending', 'sending', 'sent', 'failed', 'suppressed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.strategy_call_emails
    ADD CONSTRAINT strategy_call_emails_attempt_count_valid
    CHECK (attempt_count >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.strategy_call_emails
  DROP CONSTRAINT IF EXISTS strategy_call_emails_contact_request_id_email_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_strategy_call_emails_idempotency
  ON public.strategy_call_emails (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_strategy_call_emails_legacy_contact_type
  ON public.strategy_call_emails (contact_request_id, email_type)
  WHERE booking_id IS NULL;
DROP INDEX IF EXISTS public.idx_strategy_call_emails_pending;
CREATE INDEX idx_strategy_call_emails_pending
  ON public.strategy_call_emails (scheduled_at)
  WHERE sent_at IS NULL AND delivery_status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS public.strategy_call_funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.strategy_call_sessions(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.strategy_call_bookings(id) ON DELETE SET NULL,
  event_name text NOT NULL CHECK (event_name IN (
    'confirmation_viewed', 'booking_summary_loaded', 'booking_summary_missing',
    'video_started', 'video_progress', 'video_completed', 'video_error',
    'all_videos_completed', 'reschedule_clicked'
  )),
  content_version text NOT NULL,
  video_slug text,
  progress_percent smallint CHECK (progress_percent BETWEEN 0 AND 100),
  position_seconds integer CHECK (position_seconds >= 0),
  dedupe_key text NOT NULL UNIQUE,
  rate_limit_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_call_video_event_valid CHECK (
    event_name NOT LIKE 'video_%' OR video_slug IS NOT NULL
  ),
  CONSTRAINT strategy_call_video_slug_valid CHECK (
    video_slug IS NULL OR video_slug IN (
      'marketplace-control', 'system-walkthrough', 'faqs', 'who-its-for'
    )
  ),
  CONSTRAINT strategy_call_content_version_valid CHECK (
    content_version ~ '^[A-Za-z0-9._-]{1,64}$'
  ),
  CONSTRAINT strategy_call_position_seconds_valid CHECK (
    position_seconds IS NULL OR position_seconds <= 86400
  ),
  CONSTRAINT strategy_call_dedupe_key_valid CHECK (
    char_length(dedupe_key) BETWEEN 1 AND 256
  ),
  CONSTRAINT strategy_call_rate_limit_key_valid CHECK (
    rate_limit_key ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT strategy_call_funnel_metadata_object CHECK (
    jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 1024
  )
);

CREATE INDEX IF NOT EXISTS idx_strategy_call_funnel_events_reporting
  ON public.strategy_call_funnel_events (occurred_at DESC, event_name);
CREATE INDEX IF NOT EXISTS idx_strategy_call_funnel_events_rate_limit
  ON public.strategy_call_funnel_events (rate_limit_key, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.record_strategy_call_funnel_event(
  p_session_id uuid,
  p_booking_id uuid,
  p_event_name text,
  p_content_version text,
  p_video_slug text,
  p_progress_percent smallint,
  p_position_seconds integer,
  p_dedupe_key text,
  p_rate_limit_key text,
  p_metadata jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inserted integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('strategy-call-event:' || p_rate_limit_key, 0)
  );
  IF (
    SELECT count(*)
    FROM public.strategy_call_funnel_events e
    WHERE e.rate_limit_key = p_rate_limit_key
      AND e.occurred_at >= now() - interval '1 minute'
  ) >= 60 THEN
    RETURN 'rate_limited';
  END IF;

  INSERT INTO public.strategy_call_funnel_events (
    session_id, booking_id, event_name, content_version, video_slug,
    progress_percent, position_seconds, dedupe_key, rate_limit_key, metadata
  ) VALUES (
    p_session_id, p_booking_id, p_event_name, p_content_version, p_video_slug,
    p_progress_percent, p_position_seconds, p_dedupe_key, p_rate_limit_key,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN CASE WHEN v_inserted = 1 THEN 'accepted' ELSE 'duplicate' END;
END;
$$;

REVOKE ALL ON FUNCTION public.record_strategy_call_funnel_event(
  uuid, uuid, text, text, text, smallint, integer, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_strategy_call_funnel_event(
  uuid, uuid, text, text, text, smallint, integer, text, text, jsonb
) TO service_role;

-- Contact + session creation is one database transaction. This avoids leaving
-- orphaned lead PII if session creation or its security constraints fail.
CREATE OR REPLACE FUNCTION public.create_strategy_call_session(
  p_contact_name text,
  p_email text,
  p_phone text,
  p_fleet_size text,
  p_current_platform text,
  p_main_booking_source text,
  p_budget text,
  p_readiness text,
  p_token_hash text,
  p_submission_rate_key text,
  p_expires_at timestamptz
)
RETURNS TABLE (contact_request_id uuid, session_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_id uuid;
  v_session_id uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('strategy-call-rate:' || p_submission_rate_key, 0)
  );
  IF (
    SELECT count(*)
    FROM public.strategy_call_sessions s
    WHERE s.submission_rate_key = p_submission_rate_key
      AND s.created_at >= now() - interval '10 minutes'
  ) >= 5 THEN
    RAISE EXCEPTION 'strategy-call submission rate exceeded'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.contact_requests (
    contact_name, company_name, email, phone, fleet_size, current_platform,
    challenge, main_booking_source, budget, readiness, source, status
  ) VALUES (
    p_contact_name, 'Unknown', p_email, p_phone, p_fleet_size,
    p_current_platform, NULL, p_main_booking_source, p_budget, p_readiness,
    'strategy-call', 'pending'
  )
  RETURNING id INTO v_contact_id;

  INSERT INTO public.strategy_call_sessions (
    contact_request_id, token_hash, submission_rate_key, status, expires_at
  ) VALUES (
    v_contact_id, p_token_hash, p_submission_rate_key, 'qualified', p_expires_at
  )
  RETURNING id INTO v_session_id;

  RETURN QUERY SELECT v_contact_id, v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_strategy_call_session(
  text, text, text, text, text, text, text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_strategy_call_session(
  text, text, text, text, text, text, text, text, text, text, timestamptz
) TO service_role;

-- Apply lifecycle changes while holding the booking row lock. This is the
-- out-of-order guard: an older provider timestamp can never overwrite a newer
-- reschedule/cancellation.
CREATE OR REPLACE FUNCTION public.apply_strategy_call_booking_event(
  p_session_id uuid,
  p_contact_request_id uuid,
  p_external_booking_id text,
  p_external_calendar_id text,
  p_external_contact_id text,
  p_status text,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz,
  p_booking_timezone text,
  p_reschedule_url text,
  p_cancel_url text,
  p_meeting_url text,
  p_provider_event_at timestamptz,
  p_provider_event_id text
)
RETURNS TABLE (
  booking_id uuid,
  event_applied boolean,
  booking_created boolean,
  event_disposition text,
  booking_status text,
  schedule_changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.strategy_call_bookings%ROWTYPE;
  v_created boolean := false;
  v_effective_status text;
  v_schedule_changed boolean := false;
  v_incoming_status_rank integer;
  v_existing_status_rank integer;
BEGIN
  IF p_external_booking_id IS NULL OR btrim(p_external_booking_id) = '' THEN
    RAISE EXCEPTION 'external booking id is required';
  END IF;
  IF p_status NOT IN ('scheduled', 'rescheduled', 'cancelled', 'completed', 'no_show') THEN
    RAISE EXCEPTION 'invalid strategy-call status';
  END IF;
  IF p_scheduled_start_at IS NULL OR p_scheduled_end_at <= p_scheduled_start_at THEN
    RAISE EXCEPTION 'invalid strategy-call booking interval';
  END IF;
  IF p_provider_event_at IS NULL THEN
    RAISE EXCEPTION 'provider event timestamp is required';
  END IF;
  IF p_session_id IS NOT NULL AND (
    p_contact_request_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.strategy_call_sessions s
      WHERE s.id = p_session_id
        AND s.contact_request_id = p_contact_request_id
    )
  ) THEN
    RAISE EXCEPTION 'strategy-call session/contact mismatch';
  END IF;

  -- There is no row to lock for two simultaneous first deliveries, so use a
  -- transaction-scoped key lock before the select/insert pair.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ghl:' || p_external_booking_id, 0)
  );

  SELECT * INTO v_booking
  FROM public.strategy_call_bookings b
  WHERE b.provider = 'ghl' AND b.external_booking_id = p_external_booking_id
  FOR UPDATE;

  -- Once an external appointment has been bound, no later or concurrent
  -- delivery may silently move it to another qualifier/contact. This also
  -- protects against two first-delivery workers resolving different sessions.
  IF FOUND AND p_contact_request_id IS NOT NULL
    AND p_contact_request_id IS DISTINCT FROM v_booking.contact_request_id THEN
    RAISE EXCEPTION 'external booking/contact association mismatch';
  END IF;
  IF FOUND AND p_session_id IS NOT NULL
    AND p_session_id IS DISTINCT FROM v_booking.session_id THEN
    RAISE EXCEPTION 'external booking/session association mismatch';
  END IF;

  IF FOUND AND p_provider_event_at < v_booking.last_provider_event_at THEN
    RETURN QUERY SELECT
      v_booking.id, false, false, 'older'::text, v_booking.status,
      v_booking.last_provider_event_was_schedule_change;
    RETURN;
  END IF;
  IF FOUND AND p_provider_event_at = v_booking.last_provider_event_at THEN
    IF v_booking.last_provider_event_id = p_provider_event_id THEN
      RETURN QUERY SELECT
        v_booking.id, false, false, 'same'::text, v_booking.status,
        v_booking.last_provider_event_was_schedule_change;
      RETURN;
    END IF;
    -- Deterministic equal-timestamp tie-breaker. Terminal states outrank active
    -- states; equal-rank deliveries use provider event ID lexical order so
    -- arrival order cannot change the final result.
    v_incoming_status_rank := CASE p_status
      WHEN 'cancelled' THEN 5
      WHEN 'completed' THEN 4
      WHEN 'no_show' THEN 4
      WHEN 'rescheduled' THEN 2
      ELSE 1
    END;
    v_existing_status_rank := CASE v_booking.status
      WHEN 'cancelled' THEN 5
      WHEN 'completed' THEN 4
      WHEN 'no_show' THEN 4
      WHEN 'rescheduled' THEN 2
      ELSE 1
    END;
    IF v_incoming_status_rank < v_existing_status_rank OR (
      v_incoming_status_rank = v_existing_status_rank
      AND COALESCE(p_provider_event_id, '') <=
        COALESCE(v_booking.last_provider_event_id, '')
    ) THEN
      RETURN QUERY SELECT
        v_booking.id, false, false, 'older'::text, v_booking.status,
        v_booking.last_provider_event_was_schedule_change;
      RETURN;
    END IF;
  END IF;

  IF NOT FOUND THEN
    IF p_contact_request_id IS NULL THEN
      RAISE EXCEPTION 'contact request is required for a new booking';
    END IF;

    v_effective_status := p_status;
    v_schedule_changed := p_status IN ('scheduled', 'rescheduled');

    INSERT INTO public.strategy_call_bookings (
      session_id, contact_request_id, provider, external_booking_id,
      external_calendar_id, external_contact_id, status, scheduled_start_at,
      scheduled_end_at, booking_timezone, reschedule_url, cancel_url,
      meeting_url, booked_at, last_provider_event_at, last_provider_event_id,
      last_provider_event_was_schedule_change
    ) VALUES (
      p_session_id, p_contact_request_id, 'ghl', p_external_booking_id,
      p_external_calendar_id, p_external_contact_id, p_status,
      p_scheduled_start_at, p_scheduled_end_at, p_booking_timezone,
      p_reschedule_url, p_cancel_url, p_meeting_url, p_provider_event_at,
      p_provider_event_at, p_provider_event_id, v_schedule_changed
    )
    RETURNING * INTO v_booking;
    v_created := true;
  ELSE
    v_effective_status := p_status;
    IF p_status IN ('scheduled', 'rescheduled') THEN
      v_schedule_changed :=
        p_scheduled_start_at IS DISTINCT FROM v_booking.scheduled_start_at OR
        p_scheduled_end_at IS DISTINCT FROM v_booking.scheduled_end_at OR
        v_booking.status NOT IN ('scheduled', 'rescheduled');
      IF v_schedule_changed THEN
        v_effective_status := 'rescheduled';
      ELSE
        -- AppointmentUpdate also fires for notes/assignee/status metadata. An
        -- unchanged active interval is not a reschedule and must not suppress
        -- valid reminder jobs or change the customer-facing label.
        v_effective_status := v_booking.status;
      END IF;
    END IF;

    UPDATE public.strategy_call_bookings b SET
      external_calendar_id = COALESCE(p_external_calendar_id, b.external_calendar_id),
      external_contact_id = COALESCE(p_external_contact_id, b.external_contact_id),
      status = v_effective_status,
      scheduled_start_at = p_scheduled_start_at,
      scheduled_end_at = p_scheduled_end_at,
      booking_timezone = COALESCE(p_booking_timezone, b.booking_timezone),
      reschedule_url = COALESCE(p_reschedule_url, b.reschedule_url),
      cancel_url = COALESCE(p_cancel_url, b.cancel_url),
      meeting_url = COALESCE(p_meeting_url, b.meeting_url),
      last_provider_event_at = p_provider_event_at,
      last_provider_event_id = p_provider_event_id,
      last_provider_event_was_schedule_change = v_schedule_changed
    WHERE b.id = v_booking.id
    RETURNING * INTO v_booking;
  END IF;

  IF v_booking.session_id IS NOT NULL THEN
    UPDATE public.strategy_call_sessions s
    SET status = CASE WHEN v_booking.status = 'cancelled' THEN 'cancelled' ELSE 'booked' END
    WHERE s.id = v_booking.session_id;
  END IF;

  RETURN QUERY SELECT
    v_booking.id, true, v_created, 'applied'::text, v_booking.status,
    v_schedule_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_strategy_call_booking_event(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, text,
  text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_strategy_call_booking_event(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, text,
  text, text, text, timestamptz, text
) TO service_role;

-- These tables are intentionally inaccessible through the public Data API.
ALTER TABLE public.strategy_call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_call_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_call_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_call_funnel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_call_emails ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.strategy_call_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.strategy_call_bookings FROM anon, authenticated;
REVOKE ALL ON TABLE public.strategy_call_webhook_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.strategy_call_funnel_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.strategy_call_emails FROM anon, authenticated;

COMMENT ON TABLE public.strategy_call_sessions IS
  'Short-lived server-only handoff. token_hash is HMAC-SHA256; raw tokens live only in HttpOnly cookies.';
COMMENT ON TABLE public.strategy_call_bookings IS
  'Authoritative normalized GHL appointment lifecycle; raw webhook payloads are never retained.';
COMMENT ON COLUMN public.strategy_call_bookings.meeting_url IS
  'Server-only meeting URL for lifecycle email. It must never be returned by the public confirmation DTO.';
COMMENT ON TABLE public.strategy_call_funnel_events IS
  'Privacy-minimized first-party confirmation/video telemetry. No lead PII or provider payloads.';

-- Reuse the already configured service-role cron request so no secret is
-- committed here. Fail deployment visibly if its credential-bearing template
-- is missing; a silently absent reminder dispatcher is not an acceptable state.
DO $$
BEGIN
  PERFORM cron.unschedule('dispatch-strategy-call-emails');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'accrue-payg-charges'
      AND command LIKE '%accrue-payg-charges%'
      AND command ILIKE '%authorization%'
      AND command ILIKE '%bearer%'
  ) THEN
    RAISE EXCEPTION
      'Cannot schedule strategy-call email dispatcher: credential-bearing accrue-payg-charges cron template is missing or malformed';
  END IF;
END $$;

SELECT cron.schedule(
  'dispatch-strategy-call-emails',
  '* * * * *',
  replace(source.command, 'accrue-payg-charges', 'dispatch-strategy-call-emails')
)
FROM (
  SELECT command
  FROM cron.job
  WHERE jobname = 'accrue-payg-charges'
    AND command LIKE '%accrue-payg-charges%'
    AND command ILIKE '%authorization%'
    AND command ILIKE '%bearer%'
  LIMIT 1
) source;

-- Rollback: disable the v2 feature flag and unschedule the dispatcher. Keep the
-- additive tables during an urgent rollback; drop them only in a separately
-- reviewed migration after the agreed retention period.
