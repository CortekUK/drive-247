-- Migration: Add notifications system for in-app and email notifications

-- Create enum for notification types
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'booking_confirmed',
    'booking_new',
    'payment_received',
    'payment_due',
    'key_handed',
    'key_received',
    'document_signed',
    'rental_closed',
    'general'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type notification_type DEFAULT 'general',
  is_read BOOLEAN DEFAULT false,
  link TEXT, -- Optional link to navigate to (e.g., /rentals/uuid)
  metadata JSONB DEFAULT '{}', -- Additional data like rental_id, customer_id, etc.
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies - users can only see their own notifications
DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;
CREATE POLICY "Users can view their own notifications" ON notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
CREATE POLICY "Users can update their own notifications" ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);

DROP POLICY IF EXISTS "System can insert notifications" ON notifications;
CREATE POLICY "System can insert notifications" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can delete their own notifications" ON notifications;
CREATE POLICY "Users can delete their own notifications" ON notifications
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Create email_logs table to track sent emails
CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  template TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, sent, failed
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ
);

-- Enable RLS for email_logs
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view email logs" ON email_logs;
CREATE POLICY "Authenticated users can view email logs" ON email_logs
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "System can insert email logs" ON email_logs;
CREATE POLICY "System can insert email logs" ON email_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- Add admin_email setting if not exists
INSERT INTO settings (key, value, description)
VALUES ('admin_email', '"admin@drive917.com"', 'Admin email for notifications')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE notifications IS 'In-app notifications for users';
COMMENT ON TABLE email_logs IS 'Log of all emails sent from the system';
