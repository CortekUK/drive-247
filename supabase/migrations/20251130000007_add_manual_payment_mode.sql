-- Migration: Add manual payment mode feature

-- 1. Add payment_mode setting to org_settings
ALTER TABLE org_settings
ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'automated' CHECK (payment_mode IN ('automated', 'manual'));

-- 2. Add verification fields to payments table
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'auto_approved' CHECK (verification_status IN ('pending', 'approved', 'rejected', 'auto_approved')),
ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES app_users(id),
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS is_manual_mode BOOLEAN DEFAULT false;

-- 3. Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_payments_verification_status ON payments(verification_status);
CREATE INDEX IF NOT EXISTS idx_payments_is_manual_mode ON payments(is_manual_mode);

-- 4. Update existing payments to be auto_approved (they were processed before manual mode existed)
UPDATE payments
SET verification_status = 'auto_approved', is_manual_mode = false
WHERE verification_status IS NULL;

-- 5. Create function to get pending payment count for notifications
CREATE OR REPLACE FUNCTION get_pending_payments_count()
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM payments
    WHERE verification_status = 'pending'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Create function to approve payment
CREATE OR REPLACE FUNCTION approve_payment(
  p_payment_id UUID,
  p_approved_by UUID
)
RETURNS JSONB AS $$
DECLARE
  v_payment RECORD;
BEGIN
  -- Get payment details
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;

  IF v_payment.verification_status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment is not pending verification');
  END IF;

  -- Update payment status
  UPDATE payments
  SET verification_status = 'approved',
      verified_by = p_approved_by,
      verified_at = now(),
      updated_at = now()
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'approved_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Create function to reject payment
CREATE OR REPLACE FUNCTION reject_payment(
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

  IF v_payment.verification_status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment is not pending verification');
  END IF;

  -- Update payment status
  UPDATE payments
  SET verification_status = 'rejected',
      verified_by = p_rejected_by,
      verified_at = now(),
      rejection_reason = p_reason,
      updated_at = now()
  WHERE id = p_payment_id;

  -- If payment has associated rental, mark it as rejected
  IF v_payment.rental_id IS NOT NULL THEN
    UPDATE rentals
    SET status = 'Rejected',
        updated_at = now()
    WHERE id = v_payment.rental_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'rental_id', v_payment.rental_id,
    'rejected_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments
COMMENT ON COLUMN org_settings.payment_mode IS 'Payment verification mode: automated (no approval needed) or manual (requires admin approval)';
COMMENT ON COLUMN payments.verification_status IS 'Payment verification status: pending, approved, rejected, or auto_approved';
COMMENT ON COLUMN payments.is_manual_mode IS 'Whether this payment was created when manual mode was enabled';
COMMENT ON FUNCTION approve_payment IS 'Approve a pending payment and allow rental to proceed';
COMMENT ON FUNCTION reject_payment IS 'Reject a pending payment and mark associated rental as rejected';
