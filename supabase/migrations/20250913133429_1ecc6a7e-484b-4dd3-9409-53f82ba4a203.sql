-- Update apply_payment_fully function to use canonical Initial Fees category and be idempotent
CREATE OR REPLACE FUNCTION public.apply_payment_fully(p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payment record;
  v_active_count int;
  v_charge record;
  v_to_apply numeric(12,2);
BEGIN
  SELECT p.*
    INTO v_payment
    FROM public.payments p
    WHERE p.id = p_payment_id;

  IF v_payment IS NULL THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;

  -- Resolve rental if missing
  IF v_payment.rental_id IS NULL AND v_payment.payment_type = 'Rental' THEN
    SELECT count(*) INTO v_active_count
    FROM rentals r
    WHERE r.customer_id = v_payment.customer_id
      AND r.status = 'Active';

    IF v_active_count = 1 THEN
      UPDATE public.payments
         SET rental_id = (
           SELECT r.id
           FROM rentals r
           WHERE r.customer_id = v_payment.customer_id
             AND r.status = 'Active'
           LIMIT 1)
       WHERE id = v_payment.id;

      SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;

    ELSIF v_active_count > 1 THEN
      RAISE EXCEPTION 'Select rental to apply this payment (customer has multiple active rentals)';
    ELSE
      RAISE EXCEPTION 'No active rental found for this customer';
    END IF;
  END IF;

  -- InitialFee: immediate revenue + mark applied (IDEMPOTENT)
  IF v_payment.payment_type = 'InitialFee' THEN
    -- Mark payment as applied
    UPDATE public.payments
       SET remaining_amount = 0,
           status = 'Applied'
     WHERE id = v_payment.id;

    -- P&L Initial Fees entry (idempotent with proper unique constraint)
    -- Use canonical "Initial Fees" category (with space)
    INSERT INTO public.pnl_entries(
      vehicle_id, rental_id, customer_id, entry_date, 
      side, category, amount, source_ref, payment_id
    )
    VALUES (
      v_payment.vehicle_id, v_payment.rental_id, v_payment.customer_id, v_payment.payment_date,
      'Revenue', 'Initial Fees', v_payment.amount, v_payment.id::text, v_payment.id
    )
    ON CONFLICT ON CONSTRAINT ux_pnl_initial_fee_once DO NOTHING;

    RETURN;
  END IF;

  -- Rental payment: apply FIFO to open charges; if none, create next charge and retry
  <<apply_loop>>
  LOOP
    FOR v_charge IN
      SELECT id, remaining_amount, due_date
      FROM public.ledger_entries
      WHERE rental_id = v_payment.rental_id
        AND type = 'Charge'
        AND category = 'Rental'
        AND remaining_amount > 0
      ORDER BY due_date ASC
    LOOP
      EXIT WHEN COALESCE(v_payment.remaining_amount, v_payment.amount) <= 0;

      v_to_apply := LEAST(COALESCE(v_payment.remaining_amount, v_payment.amount), v_charge.remaining_amount);

      -- create application row
      INSERT INTO public.payment_applications(payment_id, charge_entry_id, amount_applied)
      VALUES (v_payment.id, v_charge.id, v_to_apply);

      -- reduce charge and payment
      UPDATE public.ledger_entries
         SET remaining_amount = remaining_amount - v_to_apply
       WHERE id = v_charge.id;

      UPDATE public.payments
         SET remaining_amount = COALESCE(remaining_amount, amount) - v_to_apply
       WHERE id = v_payment.id;

      -- create revenue P&L entry (for Rental payments) - use canonical category
      INSERT INTO public.pnl_entries(
        vehicle_id, rental_id, customer_id, entry_date, 
        side, category, amount, source_ref
      )
      VALUES (
        v_payment.vehicle_id, v_payment.rental_id, v_payment.customer_id, v_payment.payment_date,
        'Revenue', 'Rental', v_to_apply, v_payment.id::text
      );

      -- refresh payment record
      SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
    END LOOP;

    -- If still has remaining and no open charges, try creating the next upcoming charge once
    IF COALESCE(v_payment.remaining_amount, 0) > 0 THEN
      PERFORM public.generate_next_rental_charge(v_payment.rental_id);
      -- Then loop again to apply it
      -- Prevent infinite loop: only try once
      IF NOT EXISTS (
        SELECT 1 FROM public.ledger_entries
         WHERE rental_id = v_payment.rental_id
           AND type = 'Charge'
           AND category = 'Rental'
           AND remaining_amount > 0
      ) THEN
        EXIT apply_loop;
      END IF;
    ELSE
      EXIT apply_loop;
    END IF;
  END LOOP;

  -- Finalize payment status
  UPDATE public.payments
     SET remaining_amount = GREATEST(0, COALESCE(remaining_amount, 0)),
         status = CASE WHEN GREATEST(0, COALESCE(remaining_amount, 0)) = 0
                       THEN 'Applied' ELSE 'Partially Applied' END
   WHERE id = v_payment.id;
END;
$function$