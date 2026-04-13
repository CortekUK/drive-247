-- Add call recording and AI transcript support

-- 1. Add call recording toggle to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS call_recording_enabled BOOLEAN DEFAULT false;

-- 2. Add recording and transcript fields to call_logs
ALTER TABLE call_logs
ADD COLUMN IF NOT EXISTS recording_url TEXT,
ADD COLUMN IF NOT EXISTS recording_sid TEXT,
ADD COLUMN IF NOT EXISTS transcript TEXT,
ADD COLUMN IF NOT EXISTS ai_summary TEXT,
ADD COLUMN IF NOT EXISTS ai_action_items JSONB;
