-- Multi Chat §2 — data model (new tables only).
--
-- Additive: five new tables, nothing existing is altered, and NOTHING READS THESE
-- TABLES YET. The shared Twilio webhooks and the v1 Settings › Messaging screen keep
-- using tenants.twilio_* exactly as before; moving the webhooks onto this model is
-- a separate decision (owner, 2026-10-20: "option (a), new tables only").
--
--   tenant_phone_numbers   many numbers per tenant; a number can belong to ONE
--                          tenant (global UNIQUE); per-number forwarding and ring
--                          timeout (default 30s); voice/SMS use flags.
--   sms_suppressions       STOP / carrier opt-out list, per tenant and number.
--   integration_audit_log  append-only record of integration changes, number
--                          purchases/attaches and call records. Never holds secrets.
--   call_ai_outputs        transcript, summary, checkpoints, action items — one row
--                          per call, so generation is idempotent.
--   twilio_webhook_events  idempotency ledger keyed on the Twilio SID + event, so a
--                          retried or out-of-order webhook is recognised.
--
-- Backfill: the 7 numbers already connected (tenants.twilio_phone_number) are copied
-- into tenant_phone_numbers with source 'legacy_backfill', so the uniqueness rule
-- also protects them (no v2 tenant can attach a number a live tenant already uses).
-- This is data only; no v1 code path reads the table.
--
-- RLS: tenant staff may READ their own tenant's rows (super admins all). No client
-- role can write; every write comes from edge functions (service_role).
--
-- Rollback: 20261020150000_multichat_s2_data_model.rollback.sql.txt
-- APPLIED to production 2026-10-20.

BEGIN;

-- ── tenant_phone_numbers ────────────────────────────────────────────────────
CREATE TABLE public.tenant_phone_numbers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  e164                     text NOT NULL,
  twilio_number_sid        text,
  twilio_account_sid       text,
  country                  text,
  friendly_name            text,
  capabilities             jsonb NOT NULL DEFAULT '{"voice": false, "sms": false, "mms": false}'::jsonb,
  use_for_voice            boolean NOT NULL DEFAULT true,
  use_for_sms              boolean NOT NULL DEFAULT true,
  forwarding_enabled       boolean NOT NULL DEFAULT false,
  forwarding_number        text,
  ring_timeout_seconds     integer NOT NULL DEFAULT 30,
  status                   text NOT NULL DEFAULT 'active',
  source                   text NOT NULL,
  webhooks_verified_at     timestamptz,
  last_verified_at         timestamptz,
  last_error               text,
  created_by               uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_phone_numbers_e164_format CHECK (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT tenant_phone_numbers_forwarding_format CHECK (forwarding_number IS NULL OR forwarding_number ~ '^\+[1-9][0-9]{6,14}$'),
  -- the simplest loop: forwarding a number to itself
  CONSTRAINT tenant_phone_numbers_forwarding_not_self CHECK (forwarding_number IS NULL OR forwarding_number <> e164),
  CONSTRAINT tenant_phone_numbers_forwarding_needs_number CHECK (NOT forwarding_enabled OR forwarding_number IS NOT NULL),
  CONSTRAINT tenant_phone_numbers_ring_timeout CHECK (ring_timeout_seconds BETWEEN 5 AND 120),
  CONSTRAINT tenant_phone_numbers_status CHECK (status IN ('pending', 'active', 'misconfigured', 'released')),
  CONSTRAINT tenant_phone_numbers_source CHECK (source IN ('purchased', 'attached', 'admin_attached', 'legacy_backfill'))
);
-- One number, one tenant — across the whole platform. A released number keeps its
-- row for history but frees the number for re-attachment.
CREATE UNIQUE INDEX tenant_phone_numbers_e164_live ON public.tenant_phone_numbers (e164) WHERE status <> 'released';
CREATE UNIQUE INDEX tenant_phone_numbers_sid_live ON public.tenant_phone_numbers (twilio_number_sid) WHERE twilio_number_sid IS NOT NULL AND status <> 'released';
CREATE INDEX tenant_phone_numbers_tenant ON public.tenant_phone_numbers (tenant_id);
CREATE TRIGGER tenant_phone_numbers_set_updated_at BEFORE UPDATE ON public.tenant_phone_numbers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.tenant_phone_numbers (tenant_id, e164, twilio_number_sid, twilio_account_sid, country, capabilities, use_for_voice, use_for_sms, status, source, last_verified_at)
SELECT t.id, t.twilio_phone_number, t.twilio_phone_number_sid, t.twilio_account_sid,
       CASE WHEN t.twilio_phone_number LIKE '+1%' THEN 'US' WHEN t.twilio_phone_number LIKE '+44%' THEN 'GB' END,
       jsonb_build_object('voice', COALESCE(t.twilio_voice_enabled, false), 'sms', COALESCE(t.integration_twilio_sms, false), 'mms', false),
       COALESCE(t.twilio_voice_enabled, false), COALESCE(t.integration_twilio_sms, false),
       'active', 'legacy_backfill', t.twilio_connection_verified_at
  FROM public.tenants t
 WHERE t.twilio_phone_number ~ '^\+[1-9][0-9]{6,14}$';

-- ── sms_suppressions ────────────────────────────────────────────────────────
CREATE TABLE public.sms_suppressions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  e164                 text NOT NULL,
  phone_number_id      uuid REFERENCES public.tenant_phone_numbers(id) ON DELETE SET NULL,
  reason               text NOT NULL,
  keyword              text,
  source_message_sid   text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  released_at          timestamptz,
  released_reason      text,
  CONSTRAINT sms_suppressions_e164_format CHECK (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT sms_suppressions_reason CHECK (reason IN ('stop_keyword', 'carrier_opt_out', 'manual', 'invalid_number'))
);
-- At most one ACTIVE suppression per tenant + recipient.
CREATE UNIQUE INDEX sms_suppressions_active ON public.sms_suppressions (tenant_id, e164) WHERE released_at IS NULL;

-- ── integration_audit_log (append-only) ─────────────────────────────────────
CREATE TABLE public.integration_audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  actor_kind       text NOT NULL,
  actor_app_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  action           text NOT NULL,
  target_type      text,
  target_id        text,
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_audit_log_actor CHECK (actor_kind IN ('staff', 'super_admin', 'system', 'twilio_webhook'))
);
CREATE INDEX integration_audit_log_tenant_time ON public.integration_audit_log (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.integration_audit_log_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'integration_audit_log is append-only';
END;
$$;
CREATE TRIGGER integration_audit_log_no_change BEFORE UPDATE OR DELETE ON public.integration_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.integration_audit_log_append_only();

-- ── call_ai_outputs ─────────────────────────────────────────────────────────
CREATE TABLE public.call_ai_outputs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  call_log_id      uuid NOT NULL REFERENCES public.call_logs(id) ON DELETE CASCADE,
  recording_sid    text,
  status           text NOT NULL DEFAULT 'pending',
  transcript       jsonb,
  transcript_text  text,
  language         text,
  confidence       numeric,
  summary          text,
  checkpoints      jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_items     jsonb NOT NULL DEFAULT '[]'::jsonb,
  model            text,
  input_hash       text,
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  CONSTRAINT call_ai_outputs_status CHECK (status IN ('pending', 'transcribing', 'summarising', 'done', 'empty', 'failed')),
  CONSTRAINT call_ai_outputs_one_per_call UNIQUE (call_log_id)
);
CREATE INDEX call_ai_outputs_tenant ON public.call_ai_outputs (tenant_id);
CREATE TRIGGER call_ai_outputs_set_updated_at BEFORE UPDATE ON public.call_ai_outputs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── twilio_webhook_events (idempotency ledger) ──────────────────────────────
CREATE TABLE public.twilio_webhook_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  sid           text NOT NULL,
  event_type    text NOT NULL,
  event_status  text NOT NULL DEFAULT '',
  sequence      integer,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  outcome       text
);
-- A retried delivery of the same (SID, event, status) is the same event.
CREATE UNIQUE INDEX twilio_webhook_events_dedupe ON public.twilio_webhook_events (sid, event_type, event_status);
CREATE INDEX twilio_webhook_events_received ON public.twilio_webhook_events (received_at);

-- ── RLS: staff read own tenant; no client writes; anon nothing ──────────────
ALTER TABLE public.tenant_phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_ai_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.twilio_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tenant_phone_numbers, public.sms_suppressions, public.integration_audit_log,
              public.call_ai_outputs, public.twilio_webhook_events FROM anon, authenticated;
GRANT SELECT ON public.tenant_phone_numbers, public.sms_suppressions, public.integration_audit_log,
                public.call_ai_outputs TO authenticated;
-- twilio_webhook_events: service_role only (no client grant at all).

CREATE POLICY tenant_phone_numbers_staff_read ON public.tenant_phone_numbers FOR SELECT TO authenticated
  USING (public.chat_staff_can_access_tenant(tenant_id));
CREATE POLICY sms_suppressions_staff_read ON public.sms_suppressions FOR SELECT TO authenticated
  USING (public.chat_staff_can_access_tenant(tenant_id));
CREATE POLICY integration_audit_log_staff_read ON public.integration_audit_log FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND public.chat_staff_can_access_tenant(tenant_id));
CREATE POLICY call_ai_outputs_staff_read ON public.call_ai_outputs FOR SELECT TO authenticated
  USING (public.chat_staff_can_access_tenant(tenant_id));

COMMIT;
