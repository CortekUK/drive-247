-- SMS Messaging System
-- Extends chat tables to support SMS (and future WhatsApp/email/calling) alongside in-app messaging
-- Adds tables for unknown inbound SMS threads and delivery status logging

-- ============================================================================
-- ALTER EXISTING TABLES
-- ============================================================================

-- Add channel type to messages (in_app, sms, whatsapp, email)
ALTER TABLE chat_channel_messages
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'in_app'
  CHECK (channel IN ('in_app', 'sms', 'whatsapp', 'email'));

-- Twilio message tracking
ALTER TABLE chat_channel_messages
  ADD COLUMN IF NOT EXISTS external_id TEXT;  -- Twilio Message SID

ALTER TABLE chat_channel_messages
  ADD COLUMN IF NOT EXISTS external_status TEXT
  CHECK (external_status IS NULL OR external_status IN ('queued', 'sent', 'delivered', 'failed', 'undelivered'));

-- For inbound SMS from unknown numbers (no customer match)
ALTER TABLE chat_channel_messages
  ADD COLUMN IF NOT EXISTS from_number TEXT;

-- Track last channel used per conversation (for default send behavior)
ALTER TABLE chat_channels
  ADD COLUMN IF NOT EXISTS last_channel TEXT DEFAULT 'in_app'
  CHECK (last_channel IN ('in_app', 'sms', 'whatsapp', 'email'));

-- ============================================================================
-- NEW TABLE: SMS Unknown Threads
-- For inbound SMS from phone numbers that don't match any customer
-- ============================================================================
CREATE TABLE sms_unknown_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone_number TEXT NOT NULL,
    linked_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    linked_at TIMESTAMPTZ,
    last_message_at TIMESTAMPTZ,
    message_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, phone_number)
);

CREATE INDEX idx_sms_unknown_tenant ON sms_unknown_threads(tenant_id);
CREATE INDEX idx_sms_unknown_phone ON sms_unknown_threads(tenant_id, phone_number);
CREATE INDEX idx_sms_unknown_unlinked ON sms_unknown_threads(tenant_id) WHERE linked_customer_id IS NULL;

-- ============================================================================
-- NEW TABLE: SMS Message Log
-- Audit trail for Twilio delivery status webhooks
-- ============================================================================
CREATE TABLE sms_message_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id BIGINT REFERENCES chat_channel_messages(id) ON DELETE SET NULL,
    twilio_sid TEXT NOT NULL,
    status TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sms_log_message ON sms_message_log(message_id);
CREATE INDEX idx_sms_log_twilio_sid ON sms_message_log(twilio_sid);

-- ============================================================================
-- NEW TABLE: SMS Unknown Messages
-- Messages from unknown numbers (no channel_id since no customer match)
-- ============================================================================
CREATE TABLE sms_unknown_messages (
    id BIGSERIAL PRIMARY KEY,
    thread_id UUID NOT NULL REFERENCES sms_unknown_threads(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    sender_id UUID,  -- app_users.id for outbound replies
    content TEXT NOT NULL,
    external_id TEXT,  -- Twilio Message SID
    external_status TEXT CHECK (external_status IS NULL OR external_status IN ('queued', 'sent', 'delivered', 'failed', 'undelivered')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sms_unknown_msgs_thread ON sms_unknown_messages(thread_id, created_at DESC);

-- ============================================================================
-- INDEXES ON ALTERED TABLES
-- ============================================================================
CREATE INDEX idx_chat_messages_channel ON chat_channel_messages(channel);
CREATE INDEX idx_chat_messages_external_id ON chat_channel_messages(external_id) WHERE external_id IS NOT NULL;

-- ============================================================================
-- TENANT COLUMNS FOR 10DLC REGISTRATION
-- ============================================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_brand_sid TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_brand_status TEXT;  -- pending, approved, failed
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_campaign_sid TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_campaign_status TEXT;  -- pending, approved, failed
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_messaging_service_sid TEXT;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS
ALTER TABLE sms_unknown_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_message_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_unknown_messages ENABLE ROW LEVEL SECURITY;

-- Service role has full access
CREATE POLICY "Service role has full access to sms_unknown_threads"
    ON sms_unknown_threads FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "Service role has full access to sms_message_log"
    ON sms_message_log FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "Service role has full access to sms_unknown_messages"
    ON sms_unknown_messages FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Portal users can read their tenant's unknown threads
CREATE POLICY "Portal users can read tenant unknown threads"
    ON sms_unknown_threads FOR SELECT TO authenticated
    USING (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
    );

-- Portal users can update their tenant's unknown threads (link to customer)
CREATE POLICY "Portal users can update tenant unknown threads"
    ON sms_unknown_threads FOR UPDATE TO authenticated
    USING (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
    );

-- Portal users can read unknown messages for their tenant's threads
CREATE POLICY "Portal users can read tenant unknown messages"
    ON sms_unknown_messages FOR SELECT TO authenticated
    USING (
        thread_id IN (
            SELECT ut.id FROM sms_unknown_threads ut
            WHERE ut.tenant_id IN (
                SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
            )
        )
    );

-- Portal users can read SMS logs for messages in their tenant's channels
CREATE POLICY "Portal users can read tenant sms logs"
    ON sms_message_log FOR SELECT TO authenticated
    USING (
        message_id IN (
            SELECT ccm.id FROM chat_channel_messages ccm
            JOIN chat_channels cc ON cc.id = ccm.channel_id
            WHERE cc.tenant_id IN (
                SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
            )
        )
    );

-- Super admin access
CREATE POLICY "Super admins can read all unknown threads"
    ON sms_unknown_threads FOR SELECT TO authenticated
    USING (
        EXISTS (SELECT 1 FROM app_users au WHERE au.auth_user_id = auth.uid() AND au.is_super_admin = true)
    );

CREATE POLICY "Super admins can read all unknown messages"
    ON sms_unknown_messages FOR SELECT TO authenticated
    USING (
        EXISTS (SELECT 1 FROM app_users au WHERE au.auth_user_id = auth.uid() AND au.is_super_admin = true)
    );

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE TRIGGER set_sms_unknown_threads_updated_at
    BEFORE UPDATE ON sms_unknown_threads
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE sms_unknown_threads IS 'Tracks inbound SMS from unknown phone numbers that do not match any customer';
COMMENT ON TABLE sms_unknown_messages IS 'Messages within unknown SMS threads (before customer is linked)';
COMMENT ON TABLE sms_message_log IS 'Audit trail for Twilio SMS delivery status changes';
COMMENT ON COLUMN chat_channel_messages.channel IS 'Message channel: in_app, sms, whatsapp, email';
COMMENT ON COLUMN chat_channel_messages.external_id IS 'External message ID (e.g., Twilio Message SID)';
COMMENT ON COLUMN chat_channel_messages.external_status IS 'Delivery status from external provider';
COMMENT ON COLUMN chat_channels.last_channel IS 'Last channel used in this conversation (for default send behavior)';
