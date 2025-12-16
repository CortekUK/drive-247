-- Fix reject_payment to properly close the rental (same as close rental functionality)
-- This will:
-- 1. Mark the rental as Closed
-- 2. Set the end_date to today
-- 3. Release the vehicle (set availability to true)
-- 4. Mark payment as rejected

CREATE OR REPLACE FUNCTION reject_payment(
  p_payment_id UUID,
  p_rejected_by UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_payment RECORD;
  v_rental RECORD;
  v_vehicle_id UUID;
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

  -- If payment has associated rental, close it completely
  IF v_payment.rental_id IS NOT NULL THEN
    -- Get rental details including vehicle_id
    SELECT * INTO v_rental FROM rentals WHERE id = v_payment.rental_id;

    IF FOUND THEN
      v_vehicle_id := v_rental.vehicle_id;

      -- Close the rental (set status to Closed and end_date to today)
      UPDATE rentals
      SET status = 'Closed',
          end_date = CURRENT_DATE,
          updated_at = now()
      WHERE id = v_payment.rental_id;

      -- Release the vehicle (make it available again by setting status to 'Available')
      IF v_vehicle_id IS NOT NULL THEN
        UPDATE vehicles
        SET status = 'Available',
            updated_at = now()
        WHERE id = v_vehicle_id;
      END IF;

      -- Also mark any unpaid charges for this rental as written off/cancelled
      UPDATE ledger_entries
      SET remaining_amount = 0,
          updated_at = now()
      WHERE rental_id = v_payment.rental_id
        AND type = 'Charge'
        AND remaining_amount > 0;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'rental_id', v_payment.rental_id,
    'vehicle_released', v_vehicle_id IS NOT NULL,
    'rejected_at', now()
  );
END;
$function$;
