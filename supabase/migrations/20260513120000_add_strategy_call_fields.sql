-- Add strategy call qualifier fields to contact_requests
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS current_platform TEXT;
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'website';

-- Table for tracking email sequence state per contact
CREATE TABLE IF NOT EXISTS strategy_call_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_request_id UUID NOT NULL REFERENCES contact_requests(id) ON DELETE CASCADE,
  email_type TEXT NOT NULL CHECK (email_type IN ('confirmation', 'reminder_24h', 'reminder_1h', 'followup_attended', 'followup_noshow')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  call_time TIMESTAMPTZ,
  call_status TEXT DEFAULT 'scheduled' CHECK (call_status IN ('scheduled', 'attended', 'noshow', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(contact_request_id, email_type)
);

-- Index for finding unsent emails that are due
CREATE INDEX IF NOT EXISTS idx_strategy_call_emails_pending
  ON strategy_call_emails (scheduled_at)
  WHERE sent_at IS NULL;
