-- ============================================================================
-- Modives CheckMyDriver (CMD) verification integration
-- ============================================================================
-- Adds an additional verification path alongside the existing AI/Veriff flows.
-- The Modives flow returns two webhook event types (insurance + license);
-- per product scope, only the License outcome is surfaced in the UI.
-- Per Modives compliance: we store IDs + status only, never carrier/policy data.

-- ---------------------------------------------------------------------------
-- 1. Extend identity_verifications with CMD columns
-- ---------------------------------------------------------------------------
ALTER TABLE identity_verifications
  ADD COLUMN IF NOT EXISTS cmd_verification_id uuid,
  ADD COLUMN IF NOT EXISTS cmd_applicant_verification_id uuid,
  ADD COLUMN IF NOT EXISTS cmd_status text,
  ADD COLUMN IF NOT EXISTS cmd_license_status text,
  ADD COLUMN IF NOT EXISTS cmd_last_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS cmd_magic_link text,
  ADD COLUMN IF NOT EXISTS cmd_magic_link_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS cmd_delivery_channels text[];

COMMENT ON COLUMN identity_verifications.cmd_verification_id IS 'Modives VerificationId returned by POST /verification';
COMMENT ON COLUMN identity_verifications.cmd_applicant_verification_id IS 'Modives applicantVerificationReqGuidId returned by /verification-detail; used in webhook callbacks and magic-link generation';
COMMENT ON COLUMN identity_verifications.cmd_status IS 'Insurance side of the CMD verification: LinkSent, Verifying, Verified, Unverified (stored silently per license-only scope)';
COMMENT ON COLUMN identity_verifications.cmd_license_status IS 'License side of the CMD verification: Pending, Valid, Invalid, Expired';
COMMENT ON COLUMN identity_verifications.cmd_last_event_at IS 'Timestamp of the most recent CMD webhook event';
COMMENT ON COLUMN identity_verifications.cmd_magic_link IS 'Magic link URL returned by Modives, used to re-send to the consumer';
COMMENT ON COLUMN identity_verifications.cmd_magic_link_expires_at IS 'When the magic link expires (Modives default ~7 days)';
COMMENT ON COLUMN identity_verifications.cmd_delivery_channels IS 'Which channels the magic link was sent through, e.g. [email, sms, whatsapp]';

CREATE INDEX IF NOT EXISTS idx_identity_verifications_cmd_applicant
  ON identity_verifications(cmd_applicant_verification_id)
  WHERE cmd_applicant_verification_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Allow 'cmd' in the verification_provider CHECK
-- ---------------------------------------------------------------------------
ALTER TABLE identity_verifications
  DROP CONSTRAINT IF EXISTS identity_verifications_verification_provider_check;

ALTER TABLE identity_verifications
  ADD CONSTRAINT identity_verifications_verification_provider_check
  CHECK (verification_provider = ANY (ARRAY['veriff'::text, 'ai'::text, 'cmd'::text]));

-- ---------------------------------------------------------------------------
-- 3. modives_config — single-row global config (one Drive247 Modives account)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS modives_config (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment  text NOT NULL DEFAULT 'test' CHECK (environment IN ('test', 'live')),
  dealer_guid  uuid,
  location_guid uuid,
  terms_accepted_at timestamptz,
  terms_version text,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_modives_config_environment
  ON modives_config(environment);

CREATE TRIGGER trg_modives_config_updated_at
  BEFORE UPDATE ON modives_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE modives_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY modives_config_super_admin_read
  ON modives_config FOR SELECT
  USING (is_super_admin());

INSERT INTO modives_config (environment)
VALUES ('test')
ON CONFLICT (environment) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. cmd_webhook_events — audit log for every inbound Modives webhook
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cmd_webhook_events (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name                  text,
  object_type                 text,
  external_uuid               uuid,
  payload                     jsonb NOT NULL,
  signature_header            text,
  signature_valid             boolean NOT NULL DEFAULT false,
  processed                   boolean NOT NULL DEFAULT false,
  error                       text,
  identity_verification_id    uuid REFERENCES identity_verifications(id) ON DELETE SET NULL,
  received_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmd_webhook_events_external_uuid
  ON cmd_webhook_events(external_uuid);

CREATE INDEX IF NOT EXISTS idx_cmd_webhook_events_received_at
  ON cmd_webhook_events(received_at DESC);

ALTER TABLE cmd_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY cmd_webhook_events_super_admin_read
  ON cmd_webhook_events FOR SELECT
  USING (is_super_admin());
