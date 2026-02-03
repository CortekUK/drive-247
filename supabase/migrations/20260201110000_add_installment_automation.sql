-- Migration: Add installment automation (pg_cron jobs and notification tracking)
-- This migration sets up:
-- 1. Notification tracking table
-- 2. Cron job for processing due installments daily
-- 3. Cron job for sending reminder notifications 3 days before
-- 4. Function to mark overdue installments

-- =====================================================
-- NOTIFICATION TRACKING TABLE
-- =====================================================

-- Create notification tracking table
CREATE TABLE IF NOT EXISTS public.installment_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_id UUID NOT NULL REFERENCES scheduled_installments(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('reminder_3_days', 'due_today', 'payment_success', 'payment_failed', 'overdue')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_notification UNIQUE (installment_id, notification_type)
);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to set tenant_id on notification insert
CREATE OR REPLACE FUNCTION public.set_notification_tenant_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT ip.tenant_id INTO NEW.tenant_id
  FROM scheduled_installments si
  JOIN installment_plans ip ON si.installment_plan_id = ip.id
  WHERE si.id = NEW.installment_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_notification_tenant_id_trigger ON installment_notifications;
CREATE TRIGGER set_notification_tenant_id_trigger
  BEFORE INSERT ON installment_notifications
  FOR EACH ROW
  EXECUTE FUNCTION set_notification_tenant_id();

-- Function to record installment notification
CREATE OR REPLACE FUNCTION public.record_installment_notification(
  p_installment_id UUID,
  p_notification_type TEXT,
  p_sent_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO installment_notifications (
    installment_id,
    notification_type,
    sent_at
  ) VALUES (
    p_installment_id,
    p_notification_type,
    p_sent_at
  )
  ON CONFLICT (installment_id, notification_type)
  DO UPDATE SET sent_at = EXCLUDED.sent_at;
END;
$$;

-- Function to mark installments as overdue after 3 failed attempts and 3 days past due
CREATE OR REPLACE FUNCTION public.mark_overdue_installments()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Mark installments as overdue if:
  -- 1. Status is 'failed'
  -- 2. Failure count >= 3
  -- 3. Due date is more than 3 days ago
  UPDATE scheduled_installments
  SET status = 'overdue',
      updated_at = NOW()
  WHERE status = 'failed'
    AND failure_count >= 3
    AND due_date < CURRENT_DATE - INTERVAL '3 days';

  -- Update parent plan status to overdue if any installment is overdue
  UPDATE installment_plans ip
  SET status = 'overdue',
      updated_at = NOW()
  WHERE ip.status = 'active'
    AND EXISTS (
      SELECT 1 FROM scheduled_installments si
      WHERE si.installment_plan_id = ip.id
        AND si.status = 'overdue'
    );
END;
$$;

-- Function to get installments due for reminder (3 days before)
CREATE OR REPLACE FUNCTION public.get_installments_for_reminder()
RETURNS TABLE (
  installment_id UUID,
  plan_id UUID,
  tenant_id UUID,
  rental_id UUID,
  customer_id UUID,
  installment_number INTEGER,
  amount NUMERIC(12,2),
  due_date DATE,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_reg TEXT,
  rental_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    si.id AS installment_id,
    ip.id AS plan_id,
    ip.tenant_id,
    ip.rental_id,
    ip.customer_id,
    si.installment_number,
    si.amount,
    si.due_date,
    c.name AS customer_name,
    c.email AS customer_email,
    c.phone AS customer_phone,
    v.make AS vehicle_make,
    v.model AS vehicle_model,
    v.reg AS vehicle_reg,
    r.rental_number
  FROM scheduled_installments si
  JOIN installment_plans ip ON si.installment_plan_id = ip.id
  JOIN customers c ON ip.customer_id = c.id
  JOIN rentals r ON ip.rental_id = r.id
  JOIN vehicles v ON r.vehicle_id = v.id
  WHERE si.status = 'scheduled'
    AND si.due_date = CURRENT_DATE + INTERVAL '3 days'
    AND ip.status = 'active';
END;
$$;

-- =====================================================
-- RLS POLICIES
-- =====================================================

ALTER TABLE public.installment_notifications ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
DROP POLICY IF EXISTS "Service role can manage installment_notifications" ON installment_notifications;
CREATE POLICY "Service role can manage installment_notifications"
  ON installment_notifications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Tenant users can view their notifications
DROP POLICY IF EXISTS "Tenant users can view their installment_notifications" ON installment_notifications;
CREATE POLICY "Tenant users can view their installment_notifications"
  ON installment_notifications
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
    )
  );

-- =====================================================
-- GRANTS
-- =====================================================

GRANT SELECT, INSERT, UPDATE ON installment_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON installment_notifications TO service_role;

-- =====================================================
-- INDEXES
-- =====================================================

-- Index for finding due installments efficiently
CREATE INDEX IF NOT EXISTS idx_scheduled_installments_due_status
  ON scheduled_installments(due_date, status)
  WHERE status IN ('scheduled', 'failed');

-- Index for notification lookups
CREATE INDEX IF NOT EXISTS idx_installment_notifications_lookup
  ON installment_notifications(installment_id, notification_type);

-- =====================================================
-- PG_CRON JOBS (Manual Setup Required)
-- =====================================================

-- NOTE: pg_cron jobs require the pg_net extension for HTTP calls.
-- These jobs must be set up manually in the Supabase dashboard
-- or via direct connection if pg_cron is enabled.

-- The following SQL can be run manually if cron extension is available:

-- Job 1: Process installment payments daily at 6 AM UTC
-- SELECT cron.schedule(
--   'process-installment-payments',
--   '0 6 * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://<your-project>.supabase.co/functions/v1/process-installment-payment',
--     headers := '{"Authorization": "Bearer <service_role_key>", "Content-Type": "application/json"}'::jsonb,
--     body := '{}'::jsonb
--   );
--   $$
-- );

-- Job 2: Send reminder notifications at 9 AM UTC
-- SELECT cron.schedule(
--   'send-installment-reminders',
--   '0 9 * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://<your-project>.supabase.co/functions/v1/send-installment-reminders',
--     headers := '{"Authorization": "Bearer <service_role_key>", "Content-Type": "application/json"}'::jsonb,
--     body := '{}'::jsonb
--   );
--   $$
-- );

-- Job 3: Mark overdue installments at 7 AM UTC
-- SELECT cron.schedule(
--   'mark-overdue-installments',
--   '0 7 * * *',
--   $$SELECT public.mark_overdue_installments();$$
-- );

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON FUNCTION mark_overdue_installments IS 'Marks installments as overdue after 3 failed attempts and 3+ days past due';
COMMENT ON FUNCTION get_installments_for_reminder IS 'Returns installments that need reminder notifications (3 days before due)';
COMMENT ON FUNCTION record_installment_notification IS 'Records that a notification was sent for an installment';
COMMENT ON TABLE installment_notifications IS 'Tracks notification history for installments';
