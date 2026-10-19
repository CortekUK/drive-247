-- Email send log — one row per email the platform tries to send (QA M4, fix 2).
--
-- WHY A NEW TABLE, NOT email_logs. public.email_logs has RLS OFF and anon holds
-- INSERT/SELECT/UPDATE/DELETE on it: anyone with the public key can read every
-- row (recipient addresses, subjects) and write fake ones. A log of every email
-- written there would publish every customer's address. This table is closed:
-- only the service role writes, only super admins read. email_logs is left
-- untouched here (it is a separate finding, M4-F9).
--
-- WHAT IT IS FOR. Proving an email was sent (support), and the super-admin
-- "Emails (Resend)" monitoring tile (failure rate, volume, last success).
-- Written by _shared/resend-service.ts after every send attempt; a failed log
-- write never fails the send.
--
-- Additive only (V2_PLAN §4): a new table, a new type, nothing existing changes.

CREATE TYPE public.email_send_status AS ENUM ('sent', 'failed', 'skipped');

CREATE TABLE public.email_send_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- NULL for platform emails (Drive247 -> operator) and pre-tenant signup codes.
  tenant_id           uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  status              public.email_send_status NOT NULL,
  provider            text NOT NULL DEFAULT 'resend',
  -- The edge function that sent it, when the caller says (filled in per sender).
  source              text,
  -- The notification catalogue key, once senders are wired to settings (fix 4).
  notification_key    text,
  recipient           text NOT NULL,
  subject             text NOT NULL,
  provider_message_id text,
  http_status         integer,
  error               text,
  CONSTRAINT email_send_log_error_when_failed
    CHECK (status <> 'failed' OR error IS NOT NULL)
);

CREATE INDEX email_send_log_created_at_idx ON public.email_send_log (created_at DESC);
CREATE INDEX email_send_log_tenant_created_idx ON public.email_send_log (tenant_id, created_at DESC);
CREATE INDEX email_send_log_failed_idx ON public.email_send_log (created_at DESC) WHERE status = 'failed';

ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.email_send_log FROM anon, authenticated;
GRANT SELECT ON public.email_send_log TO authenticated;

CREATE POLICY email_send_log_super_admin_read
  ON public.email_send_log
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

COMMENT ON TABLE public.email_send_log IS
  'One row per email send attempt (QA M4). Service role writes; super admins read. Never reuse email_logs (open to anon).';
