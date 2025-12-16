-- Fix/recreate the reject_payment function to ensure rental status is updated

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
      status = 'Rejected',
      updated_at = now()
  WHERE id = p_payment_id;

  -- If payment has associated rental, mark it as rejected
  IF v_payment.rental_id IS NOT NULL THEN
    UPDATE rentals
    SET status = 'Rejected',
        updated_at = now()
    WHERE id = v_payment.rental_id;

    RAISE NOTICE 'Rental % marked as Rejected', v_payment.rental_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'rental_id', v_payment.rental_id,
    'rejected_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION reject_payment TO authenticated;
GRANT EXECUTE ON FUNCTION reject_payment TO service_role;
