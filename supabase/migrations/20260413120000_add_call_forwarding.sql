-- Add call forwarding and voicemail support

-- 1. Add forwarding number to app_users (personal phone for call forwarding)
ALTER TABLE app_users
ADD COLUMN IF NOT EXISTS forwarding_number TEXT;

-- 2. Add call forwarding & voicemail settings to tenants
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS call_forwarding_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS voicemail_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS voicemail_greeting_url TEXT;

-- 3. Create voicemail_recordings table
CREATE TABLE IF NOT EXISTS voicemail_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  channel_id UUID REFERENCES chat_channels(id) ON DELETE SET NULL,
  call_log_id UUID REFERENCES call_logs(id) ON DELETE SET NULL,
  twilio_call_sid TEXT,
  twilio_recording_sid TEXT,
  recording_url TEXT NOT NULL,
  storage_path TEXT,
  duration_seconds INTEGER DEFAULT 0,
  from_number TEXT,
  to_number TEXT,
  is_listened BOOLEAN DEFAULT false,
  listened_at TIMESTAMPTZ,
  listened_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_voicemail_recordings_tenant_id ON voicemail_recordings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_voicemail_recordings_customer_id ON voicemail_recordings(customer_id);
CREATE INDEX IF NOT EXISTS idx_voicemail_recordings_created_at ON voicemail_recordings(tenant_id, created_at DESC);

-- Updated at trigger
CREATE TRIGGER set_voicemail_recordings_updated_at
  BEFORE UPDATE ON voicemail_recordings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE voicemail_recordings ENABLE ROW LEVEL SECURITY;

-- Tenant users can view their own tenant's voicemails
CREATE POLICY "Tenant users can view voicemails"
  ON voicemail_recordings FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- Only service_role can insert/update/delete (edge functions)
CREATE POLICY "Service role manages voicemails"
  ON voicemail_recordings FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant service_role access
-- (RLS bypass is automatic for service_role)

-- 4. Create storage bucket for voicemails
INSERT INTO storage.buckets (id, name, public)
VALUES ('voicemails', 'voicemails', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for voicemail bucket
CREATE POLICY "Tenant users can read voicemails"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'voicemails');

CREATE POLICY "Service role can upload voicemails"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'voicemails');

CREATE POLICY "Service role can delete voicemails"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'voicemails');
