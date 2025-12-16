-- ================================================
-- SCHEDULED REFUNDS SUPPORT
-- ================================================
-- Add capability to schedule refunds for future processing
-- Integrates with reminders system for automated processing

ALTER TABLE payments
-- Refund Status
ADD COLUMN IF NOT EXISTS refund_status TEXT CHECK (refund_status IN ('none', 'scheduled', 'processing', 'completed', 'failed')) DEFAULT 'none',

-- Scheduled Date for Refund Processing
ADD COLUMN IF NOT EXISTS refund_scheduled_date TIMESTAMPTZ,

-- Refund Amount (may be partial)
ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10,2) CHECK (refund_amount >= 0),

-- Reason for Refund
ADD COLUMN IF NOT EXISTS refund_reason TEXT,

-- When Refund Was Processed
ADD COLUMN IF NOT EXISTS refund_processed_at TIMESTAMPTZ,

-- Stripe Refund ID (if processed)
ADD COLUMN IF NOT EXISTS stripe_refund_id TEXT,

-- Admin Who Scheduled the Refund
ADD COLUMN IF NOT EXISTS refund_scheduled_by UUID REFERENCES auth.users(id);

-- ================================================
-- INDEXES FOR SCHEDULED REFUND QUERIES
-- ================================================

-- Index for finding refunds due for processing
CREATE INDEX IF NOT EXISTS idx_payments_refund_scheduled
  ON payments(refund_scheduled_date)
  WHERE refund_status = 'scheduled' AND refund_scheduled_date IS NOT NULL;

-- Index for refund status queries
CREATE INDEX IF NOT EXISTS idx_payments_refund_status
  ON payments(refund_status) WHERE refund_status != 'none';

-- Composite index for admin refund management
CREATE INDEX IF NOT EXISTS idx_payments_customer_refund_status
  ON payments(customer_id, refund_status) WHERE refund_status != 'none';

-- ================================================
-- COMMENTS FOR DOCUMENTATION
-- ================================================

COMMENT ON COLUMN payments.refund_status IS 'Status of refund: none, scheduled, processing, completed, failed';
COMMENT ON COLUMN payments.refund_scheduled_date IS 'Date when refund should be processed (NULL for immediate refunds)';
COMMENT ON COLUMN payments.refund_amount IS 'Amount to refund (may be partial, NULL means full refund)';
COMMENT ON COLUMN payments.refund_reason IS 'Admin-provided reason for the refund';
COMMENT ON COLUMN payments.refund_processed_at IS 'Timestamp when refund was actually processed';
COMMENT ON COLUMN payments.stripe_refund_id IS 'Stripe refund ID if refund was processed via Stripe';
COMMENT ON COLUMN payments.refund_scheduled_by IS 'Admin user who scheduled the refund';

-- ================================================
-- FUNCTION: Get Scheduled Refunds Due Today
-- ================================================

CREATE OR REPLACE FUNCTION get_refunds_due_today()
RETURNS TABLE (
  payment_id UUID,
  customer_id UUID,
  rental_id UUID,
  refund_amount NUMERIC,
  refund_reason TEXT,
  stripe_payment_intent_id TEXT,
  customer_email TEXT,
  customer_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS payment_id,
    p.customer_id,
    p.rental_id,
    COALESCE(p.refund_amount, p.amount) AS refund_amount,
    p.refund_reason,
    p.stripe_payment_intent_id,
    c.email AS customer_email,
    c.name AS customer_name
  FROM payments p
  JOIN customers c ON c.id = p.customer_id
  WHERE p.refund_status = 'scheduled'
    AND p.refund_scheduled_date IS NOT NULL
    AND DATE(p.refund_scheduled_date) <= CURRENT_DATE
  ORDER BY p.refund_scheduled_date ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================
-- FUNCTION: Update Refund Status
-- ================================================

CREATE OR REPLACE FUNCTION update_refund_status(
  p_payment_id UUID,
  p_status TEXT,
  p_stripe_refund_id TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE payments
  SET
    refund_status = p_status,
    refund_processed_at = CASE
      WHEN p_status = 'completed' THEN now()
      ELSE refund_processed_at
    END,
    stripe_refund_id = COALESCE(p_stripe_refund_id, stripe_refund_id)
  WHERE id = p_payment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================
-- GRANT PERMISSIONS
-- ================================================

GRANT EXECUTE ON FUNCTION get_refunds_due_today() TO service_role;
GRANT EXECUTE ON FUNCTION update_refund_status(UUID, TEXT, TEXT) TO service_role;

-- ================================================
-- ADD REFUND EVENT TYPE TO REMINDERS (If Not Exists)
-- ================================================

-- This assumes reminder_events table exists from the reminders system
-- Add a new event type for scheduled refund processing

DO $$
BEGIN
  -- Check if reminder_events table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reminder_events') THEN
    -- Table exists, we can add comment about refund event type
    -- The refund event will be created by the schedule-refund edge function
    RAISE NOTICE 'reminder_events table found - refund events will be created via edge function';
  ELSE
    RAISE NOTICE 'reminder_events table not found - reminder integration will be added when table is available';
  END IF;
END $$;
