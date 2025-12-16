-- Create unique indexes for proper ON CONFLICT constraint handling
CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_entries_payment_id
ON public.ledger_entries (payment_id)
WHERE payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pnl_source_reference  
ON public.pnl_entries (source_ref)
WHERE source_ref IS NOT NULL;

-- Update process_payment_transaction to use constraint-based ON CONFLICT
CREATE OR REPLACE FUNCTION public.process_payment_transaction(p_payment_id uuid, p_customer_id uuid, p_rental_id uuid, p_vehicle_id uuid, p_amount numeric, p_payment_type text, p_payment_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_category TEXT;
  v_allocated NUMERIC := 0;
  v_payment_remaining NUMERIC;
  v_status TEXT;
  v_charge RECORD;
  v_to_apply NUMERIC;
  v_has_side_column BOOLEAN;
BEGIN
  -- Category mapping
  v_category := CASE 
    WHEN LOWER(p_payment_type) IN ('initial fee', 'initial fees', 'initialfee') THEN 'Initial Fees'
    WHEN LOWER(p_payment_type) = 'rental' THEN 'Rental'
    WHEN LOWER(p_payment_type) = 'fine' THEN 'Fines'
    ELSE 'Other'
  END;
  
  -- Check if pnl_entries has 'side' column (cache this in production)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'pnl_entries' 
    AND column_name = 'side'
  ) INTO v_has_side_column;
  
  -- Insert ledger payment entry (idempotent using constraint)
  INSERT INTO public.ledger_entries (
    customer_id, rental_id, vehicle_id, entry_date, 
    type, category, amount, due_date, remaining_amount, payment_id
  )
  VALUES (
    p_customer_id, p_rental_id, p_vehicle_id, p_payment_date,
    'Payment', v_category, -p_amount, p_payment_date, 0, p_payment_id
  )
  ON CONFLICT ON CONSTRAINT ux_ledger_entries_payment_id DO NOTHING;
  
  -- Insert P&L revenue entry (idempotent using constraint)
  IF v_has_side_column THEN
    INSERT INTO public.pnl_entries (
      vehicle_id, entry_date, side, category, amount, source_ref, customer_id
    )
    VALUES (
      p_vehicle_id, p_payment_date, 'Revenue', v_category, p_amount, p_payment_id::TEXT, p_customer_id
    )
    ON CONFLICT ON CONSTRAINT ux_pnl_source_reference DO NOTHING;
  ELSE
    INSERT INTO public.pnl_entries (
      vehicle_id, entry_date, category, amount, source_ref, customer_id
    )
    VALUES (
      p_vehicle_id, p_payment_date, v_category, p_amount, p_payment_id::TEXT, p_customer_id
    )
    ON CONFLICT ON CONSTRAINT ux_pnl_source_reference DO NOTHING;
  END IF;
  
  v_payment_remaining := p_amount;
  
  -- FIFO allocation for rental payments only
  IF p_rental_id IS NOT NULL AND v_category = 'Rental' THEN
    FOR v_charge IN
      SELECT id, remaining_amount, due_date, entry_date
      FROM ledger_entries
      WHERE rental_id = p_rental_id
        AND type = 'Charge'
        AND category = 'Rental'
        AND remaining_amount > 0
      ORDER BY due_date ASC, entry_date ASC, id ASC
    LOOP
      EXIT WHEN v_payment_remaining <= 0;
      
      v_to_apply := LEAST(v_charge.remaining_amount, v_payment_remaining);
      
      -- Create payment application
      INSERT INTO payment_applications (payment_id, charge_entry_id, amount_applied)
      VALUES (p_payment_id, v_charge.id, v_to_apply)
      ON CONFLICT ON CONSTRAINT ux_payment_app_unique DO NOTHING;
      
      -- Update charge remaining amount
      UPDATE ledger_entries
      SET remaining_amount = remaining_amount - v_to_apply
      WHERE id = v_charge.id;
      
      v_allocated := v_allocated + v_to_apply;
      v_payment_remaining := v_payment_remaining - v_to_apply;
    END LOOP;
  END IF;
  
  -- Determine payment status
  IF v_payment_remaining = 0 THEN
    v_status := 'Applied';
  ELSIF v_payment_remaining = p_amount THEN
    v_status := 'Credit';
  ELSE
    v_status := 'Partial';
  END IF;
  
  -- Update payment status
  UPDATE payments
  SET status = v_status, remaining_amount = v_payment_remaining
  WHERE id = p_payment_id;
  
  -- Return success result
  RETURN jsonb_build_object(
    'success', true,
    'paymentId', p_payment_id,
    'category', v_category,
    'allocated', v_allocated,
    'remaining', v_payment_remaining,
    'status', v_status
  );
  
EXCEPTION
  WHEN OTHERS THEN
    -- Return error result
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE || ': ' || SQLERRM
    );
END;
$function$;