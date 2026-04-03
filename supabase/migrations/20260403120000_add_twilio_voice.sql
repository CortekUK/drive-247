-- Add Twilio Voice columns to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_twiml_app_sid TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_api_key_sid TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_api_key_secret TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_voice_enabled BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_voice_webhook_configured BOOLEAN DEFAULT false;

-- Create call_logs table for tracking voice calls
CREATE TABLE IF NOT EXISTS call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  channel_id UUID REFERENCES chat_channels(id) ON DELETE SET NULL,
  caller_type TEXT NOT NULL CHECK (caller_type IN ('tenant', 'customer')),
  caller_id UUID,
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'canceled', 'failed')),
  duration_seconds INTEGER DEFAULT 0,
  twilio_call_sid TEXT,
  from_number TEXT,
  to_number TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying call logs by tenant
CREATE INDEX IF NOT EXISTS idx_call_logs_tenant_created
  ON call_logs (tenant_id, created_at DESC);

-- Enable RLS
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

-- SELECT: tenant users can see their own tenant's call logs, super admins can see all
CREATE POLICY "call_logs_select"
  ON call_logs FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- INSERT: only service_role (edge functions)
CREATE POLICY "call_logs_insert"
  ON call_logs FOR INSERT
  WITH CHECK (false);

-- UPDATE: only service_role (edge functions)
CREATE POLICY "call_logs_update"
  ON call_logs FOR UPDATE
  USING (false)
  WITH CHECK (false);

-- updated_at trigger using existing function
CREATE TRIGGER set_call_logs_updated_at
  BEFORE UPDATE ON call_logs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Index for looking up calls by Twilio CallSid (used by status callback)
CREATE INDEX IF NOT EXISTS idx_call_logs_twilio_call_sid
  ON call_logs (twilio_call_sid);

-- Add 'voice' to the chat_channel_messages.channel CHECK constraint
-- Drop and re-add the constraint to include 'voice'
ALTER TABLE chat_channel_messages DROP CONSTRAINT IF EXISTS chat_channel_messages_channel_check;
ALTER TABLE chat_channel_messages ADD CONSTRAINT chat_channel_messages_channel_check
  CHECK (channel IN ('in_app', 'sms', 'whatsapp', 'email', 'voice'));

-- Add 'voice' to chat_channels.last_channel CHECK constraint
ALTER TABLE chat_channels DROP CONSTRAINT IF EXISTS chat_channels_last_channel_check;
ALTER TABLE chat_channels ADD CONSTRAINT chat_channels_last_channel_check
  CHECK (last_channel IN ('in_app', 'sms', 'whatsapp', 'email', 'voice'));
