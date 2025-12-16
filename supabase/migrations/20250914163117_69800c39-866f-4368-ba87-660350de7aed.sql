-- Create comprehensive reminders system tables (fixed policy names)
-- Core reminders table with proper structure
CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code TEXT NOT NULL,                      -- e.g. VEH_MOT_30D, INS_EXP_7D, RENT_OVERDUE
  object_type TEXT NOT NULL,                    -- Vehicle | Rental | Customer | Fine | Document
  object_id UUID NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  due_on DATE NOT NULL,                         -- natural due date (e.g., MOT date, fine due date)
  remind_on DATE NOT NULL,                      -- when the reminder should surface
  severity TEXT NOT NULL DEFAULT 'info',        -- info|warning|critical
  status TEXT NOT NULL DEFAULT 'pending',       -- pending|sent|snoozed|done|dismissed|expired
  snooze_until DATE,                            -- optional
  last_sent_at TIMESTAMPTZ,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,   -- extra data: reg, policy_no, amounts, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: one reminder per rule/object/due/remind_on
CREATE UNIQUE INDEX IF NOT EXISTS ux_reminders_identity
  ON reminders (rule_code, object_type, object_id, due_on, remind_on);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_reminders_status_remind_on ON reminders (status, remind_on);
CREATE INDEX IF NOT EXISTS idx_reminders_object ON reminders (object_type, object_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due_status ON reminders (due_on, status);

-- Actions / audit table
CREATE TABLE IF NOT EXISTS reminder_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id UUID NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  action TEXT NOT NULL,                         -- created|sent|snoozed|done|dismissed|expired|rescheduled
  actor_id UUID,                                -- admin user id (nullable for system)
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for audit queries
CREATE INDEX IF NOT EXISTS idx_reminder_actions_reminder_id ON reminder_actions (reminder_id);
CREATE INDEX IF NOT EXISTS idx_reminder_actions_created_at ON reminder_actions (created_at DESC);

-- Optional: outbound email log for digest
CREATE TABLE IF NOT EXISTS reminder_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,
  meta JSONB
);

-- Enable RLS on all tables (only if not already enabled)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'reminders' AND relrowsecurity = true) THEN
    ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'reminder_actions' AND relrowsecurity = true) THEN
    ALTER TABLE reminder_actions ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'reminder_emails' AND relrowsecurity = true) THEN
    ALTER TABLE reminder_emails ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Drop existing policies if they exist and create new ones
DROP POLICY IF EXISTS "Allow all operations for app users on reminders" ON reminders;
DROP POLICY IF EXISTS "Allow all operations for app users on reminder_actions" ON reminder_actions;
DROP POLICY IF EXISTS "Allow all operations for app users on reminder_emails" ON reminder_emails;

-- RLS policies for admin access
CREATE POLICY "Enable all operations for authenticated users - reminders" 
ON reminders FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Enable all operations for authenticated users - reminder_actions" 
ON reminder_actions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Enable all operations for authenticated users - reminder_emails" 
ON reminder_emails FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_reminders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS update_reminders_updated_at ON reminders;

-- Create trigger for updated_at
CREATE TRIGGER update_reminders_updated_at
  BEFORE UPDATE ON reminders
  FOR EACH ROW
  EXECUTE FUNCTION update_reminders_updated_at();

-- Configuration table for reminder settings
CREATE TABLE IF NOT EXISTS reminder_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT NOT NULL UNIQUE,
  config_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on config
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'reminder_config' AND relrowsecurity = true) THEN
    ALTER TABLE reminder_config ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Drop existing policy if exists
DROP POLICY IF EXISTS "Allow all operations for app users on reminder_config" ON reminder_config;
DROP POLICY IF EXISTS "Enable all operations for authenticated users - reminder_config" ON reminder_config;

CREATE POLICY "Enable all operations for authenticated users - reminder_config" 
ON reminder_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Insert default configuration
INSERT INTO reminder_config (config_key, config_value) VALUES
('reminders.enabled', 'true'),
('reminders.timezone', '"Europe/London"'),
('reminders.daily_run_at', '"08:00"'),
('reminders.email_digest.enabled', 'false'),
('reminders.email_digest.recipients', '"admin@company.com"')
ON CONFLICT (config_key) DO NOTHING;