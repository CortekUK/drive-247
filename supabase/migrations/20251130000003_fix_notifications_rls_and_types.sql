-- Migration: Fix notifications RLS policies and add reminder notification types

-- First, change the type column to TEXT to allow any notification type
-- This is more flexible than maintaining an enum
ALTER TABLE notifications
  ALTER COLUMN type TYPE TEXT USING type::TEXT,
  ALTER COLUMN type SET DEFAULT 'general';

-- Drop the old enum if it exists (won't affect the table since we already changed the column type)
DROP TYPE IF EXISTS notification_type;

-- Fix RLS policies to use app_users.auth_user_id mapping
-- The notifications.user_id stores app_users.id, not auth.uid()
-- We need to join through app_users to check the auth_user_id

DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;
CREATE POLICY "Users can view their own notifications" ON notifications
  FOR SELECT TO authenticated
  USING (
    user_id IN (SELECT id FROM app_users WHERE auth_user_id = auth.uid())
    OR user_id IS NULL
  );

DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
CREATE POLICY "Users can update their own notifications" ON notifications
  FOR UPDATE TO authenticated
  USING (
    user_id IN (SELECT id FROM app_users WHERE auth_user_id = auth.uid())
    OR user_id IS NULL
  );

DROP POLICY IF EXISTS "Users can delete their own notifications" ON notifications;
CREATE POLICY "Users can delete their own notifications" ON notifications
  FOR DELETE TO authenticated
  USING (
    user_id IN (SELECT id FROM app_users WHERE auth_user_id = auth.uid())
    OR user_id IS NULL
  );

-- Keep the system insert policy as is (allows any authenticated user to insert)
DROP POLICY IF EXISTS "System can insert notifications" ON notifications;
CREATE POLICY "System can insert notifications" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Also add a policy for service role to bypass RLS (edge functions use service role)
-- This ensures edge functions can always insert
DROP POLICY IF EXISTS "Service role can do anything" ON notifications;

COMMENT ON COLUMN notifications.type IS 'Notification type: booking_new, booking_confirmed, payment_received, payment_due, key_handed, key_received, document_signed, rental_closed, reminder_critical, reminder_warning, reminder_info, general';
