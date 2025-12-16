-- Migration: Add booking payment mode for customer website bookings
-- This is separate from the existing payment_mode which is for admin-created rentals

-- 1. Add booking_payment_mode to org_settings
-- MANUAL: Pre-authorization (hold) → admin review → capture/release
-- AUTO: Immediate capture, no admin review needed
ALTER TABLE org_settings
ADD COLUMN IF NOT EXISTS booking_payment_mode TEXT DEFAULT 'manual'
  CHECK (booking_payment_mode IN ('manual', 'auto'));

-- 2. Add Stripe payment intent columns to payments table for pre-auth tracking
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT,
ADD COLUMN IF NOT EXISTS capture_status TEXT DEFAULT NULL
  CHECK (capture_status IS NULL OR capture_status IN ('requires_capture', 'captured', 'cancelled', 'expired')),
ADD COLUMN IF NOT EXISTS preauth_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS booking_source TEXT DEFAULT 'admin'
  CHECK (booking_source IN ('admin', 'website'));

-- 3. Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_payments_stripe_payment_intent ON payments(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payments_capture_status ON payments(capture_status);
CREATE INDEX IF NOT EXISTS idx_payments_booking_source ON payments(booking_source);
CREATE INDEX IF NOT EXISTS idx_payments_preauth_expires ON payments(preauth_expires_at)
  WHERE capture_status = 'requires_capture';

-- 4. Add pending status to rentals for bookings awaiting approval
-- First check if the constraint exists and drop it
DO $$
BEGIN
  -- Try to drop the existing constraint
  BEGIN
    ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_status_check;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Ignore if doesn't exist
  END;

  -- Add the new constraint with Pending status
  BEGIN
    ALTER TABLE rentals ADD CONSTRAINT rentals_status_check
      CHECK (status IN ('Pending', 'Active', 'Closed', 'Rejected', 'Cancelled'));
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Ignore if already exists with correct values
  END;
END $$;

-- 5. Create function to get pending customer bookings count (for admin dashboard)
CREATE OR REPLACE FUNCTION get_pending_bookings_count()
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM rentals r
    JOIN payments p ON p.rental_id = r.id
    WHERE r.status = 'Pending'
      AND p.booking_source = 'website'
      AND p.capture_status = 'requires_capture'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Create function to get bookings expiring soon (pre-auth > 5 days old)
CREATE OR REPLACE FUNCTION get_expiring_bookings()
RETURNS TABLE (
  rental_id UUID,
  payment_id UUID,
  customer_name TEXT,
  vehicle_reg TEXT,
  amount NUMERIC,
  days_remaining INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id as rental_id,
    p.id as payment_id,
    c.name as customer_name,
    v.reg as vehicle_reg,
    p.amount,
    EXTRACT(DAY FROM (p.preauth_expires_at - now()))::INTEGER as days_remaining
  FROM rentals r
  JOIN payments p ON p.rental_id = r.id
  JOIN customers c ON c.id = r.customer_id
  JOIN vehicles v ON v.id = r.vehicle_id
  WHERE r.status = 'Pending'
    AND p.capture_status = 'requires_capture'
    AND p.preauth_expires_at IS NOT NULL
    AND p.preauth_expires_at < (now() + INTERVAL '2 days')
    AND p.preauth_expires_at > now()
  ORDER BY p.preauth_expires_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Update approve_payment function to handle Stripe capture
CREATE OR REPLACE FUNCTION approve_booking_payment(
  p_payment_id UUID,
  p_approved_by UUID
)
RETURNS JSONB AS $$
DECLARE
  v_payment RECORD;
  v_rental RECORD;
BEGIN
  -- Get payment details
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;

  IF v_payment.capture_status != 'requires_capture' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment is not awaiting capture');
  END IF;

  -- Note: Actual Stripe capture must be done via edge function before calling this

  -- Update payment status
  UPDATE payments
  SET capture_status = 'captured',
      verification_status = 'approved',
      verified_by = p_approved_by,
      verified_at = now(),
      updated_at = now()
  WHERE id = p_payment_id;

  -- Activate the rental
  IF v_payment.rental_id IS NOT NULL THEN
    UPDATE rentals
    SET status = 'Active',
        updated_at = now()
    WHERE id = v_payment.rental_id;

    -- Mark vehicle as Rented
    SELECT * INTO v_rental FROM rentals WHERE id = v_payment.rental_id;
    IF v_rental.vehicle_id IS NOT NULL THEN
      UPDATE vehicles
      SET status = 'Rented',
          updated_at = now()
      WHERE id = v_rental.vehicle_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'rental_id', v_payment.rental_id,
    'stripe_payment_intent_id', v_payment.stripe_payment_intent_id,
    'approved_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Create function to reject/cancel booking
CREATE OR REPLACE FUNCTION reject_booking_payment(
  p_payment_id UUID,
  p_rejected_by UUID,
  p_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_payment RECORD;
  v_rental RECORD;
BEGIN
  -- Get payment details
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;

  IF v_payment.capture_status NOT IN ('requires_capture', NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment cannot be cancelled');
  END IF;

  -- Note: Actual Stripe cancellation must be done via edge function before calling this

  -- Update payment status
  UPDATE payments
  SET capture_status = 'cancelled',
      verification_status = 'rejected',
      verified_by = p_rejected_by,
      verified_at = now(),
      rejection_reason = p_reason,
      updated_at = now()
  WHERE id = p_payment_id;

  -- Cancel the rental
  IF v_payment.rental_id IS NOT NULL THEN
    UPDATE rentals
    SET status = 'Cancelled',
        updated_at = now()
    WHERE id = v_payment.rental_id;

    -- Keep vehicle as Available (it was never marked as Rented for pending bookings)
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'rental_id', v_payment.rental_id,
    'stripe_payment_intent_id', v_payment.stripe_payment_intent_id,
    'rejected_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments
COMMENT ON COLUMN org_settings.booking_payment_mode IS 'Customer website booking mode: manual (pre-auth with admin review) or auto (immediate capture)';
COMMENT ON COLUMN payments.stripe_payment_intent_id IS 'Stripe PaymentIntent ID for pre-authorized payments';
COMMENT ON COLUMN payments.capture_status IS 'Pre-auth status: requires_capture (held), captured (charged), cancelled (released), expired';
COMMENT ON COLUMN payments.preauth_expires_at IS 'When the pre-authorization will expire (7 days from creation)';
COMMENT ON COLUMN payments.booking_source IS 'Where the booking originated: admin (portal) or website (customer)';
COMMENT ON FUNCTION get_pending_bookings_count IS 'Returns count of pending customer bookings awaiting admin approval';
COMMENT ON FUNCTION get_expiring_bookings IS 'Returns bookings with pre-auth expiring within 2 days';
COMMENT ON FUNCTION approve_booking_payment IS 'Approve a pending booking payment (call Stripe capture first)';
COMMENT ON FUNCTION reject_booking_payment IS 'Reject a pending booking payment (call Stripe cancel first)';
