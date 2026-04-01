-- Add automated return reminder settings to tenants
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS return_reminder_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS return_reminder_hours integer NOT NULL DEFAULT 24;

-- Track whether a return reminder has been sent for each rental
ALTER TABLE rentals
  ADD COLUMN IF NOT EXISTS return_reminder_sent_at timestamptz;
