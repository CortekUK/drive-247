-- Fix the 7-parameter version of process_payment_transaction function to use proper ON CONFLICT syntax
CREATE OR REPLACE FUNCTION public.process_payment_transaction(
  p_payment_id uuid, 
  p_customer_id uuid, 
  p_rental_id uuid, 
  p_vehicle_id uuid, 
  p_amount numeric, 
  p_payment_type text, 
  p_payment_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_category TEXT;
  v_allocated NUMERIC := 0;
  v_payment_remaining NUMERIC;
  v_status TEXT;
  v_charge RECORD;
  v_to_apply NUMERIC;
  v_has_side_column BOOLEAN;
BEGIN
  -- Start transaction
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
    
    -- Insert ledger payment entry (idempotent using column name)
    INSERT INTO public.ledger_entries (
      customer_id, rental_id, vehicle_id, entry_date, 
      type, category, amount, due_date, remaining_amount, payment_id
    )
    VALUES (
      p_customer_id, p_rental_id, p_vehicle_id, p_payment_date,
      'Payment', v_category, -p_amount, p_payment_date, 0, p_payment_id
    )
    ON CONFLICT (payment_id) DO NOTHING;
    
    -- Insert P&L revenue entry (idempotent using column name)
    IF v_has_side_column THEN
      INSERT INTO public.pnl_entries (
        vehicle_id, entry_date, side, category, amount, reference, customer_id
      )
      VALUES (
        p_vehicle_id, p_payment_date, 'Revenue', v_category, p_amount, p_payment_id::TEXT, p_customer_id
      )
      ON CONFLICT (reference) DO NOTHING;
    ELSE
      INSERT INTO public.pnl_entries (
        vehicle_id, entry_date, category, amount, reference, customer_id
      )
      VALUES (
        p_vehicle_id, p_payment_date, v_category, p_amount, p_payment_id::TEXT, p_customer_id
      )
      ON CONFLICT (reference) DO NOTHING;
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
        
        -- Create payment application (using column names)
        INSERT INTO payment_applications (payment_id, charge_entry_id, amount_applied)
        VALUES (p_payment_id, v_charge.id, v_to_apply)
        ON CONFLICT (payment_id, charge_entry_id) DO NOTHING;
        
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
    
    -- Return success result with clean JSON
    RETURN jsonb_build_object(
      'success', true,
      'ok', true,
      'payment_id', p_payment_id,
      'category', v_category,
      'allocated', v_allocated,
      'remaining', v_payment_remaining,
      'status', v_status
    );
    
  EXCEPTION
    WHEN OTHERS THEN
      -- Return error result with clean JSON
      RETURN jsonb_build_object(
        'success', false,
        'ok', false,
        'error', SQLERRM,
        'detail', SQLSTATE || ': ' || SQLERRM
      );
  END;
END;
$$;