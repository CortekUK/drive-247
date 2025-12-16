-- Function to backfill missing rental_ids for existing payments
CREATE OR REPLACE FUNCTION backfill_payment_rental_ids()
RETURNS TABLE(payments_updated integer, payments_skipped integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  updated_count INTEGER := 0;
  skipped_count INTEGER := 0;
  payment_record RECORD;
  found_rental_id UUID;
BEGIN
  -- Process payments that have customer_id and vehicle_id but no rental_id
  FOR payment_record IN
    SELECT id, customer_id, vehicle_id, payment_date
    FROM payments
    WHERE customer_id IS NOT NULL 
      AND vehicle_id IS NOT NULL 
      AND rental_id IS NULL
  LOOP
    -- Find the active rental for this customer+vehicle combination
    SELECT r.id INTO found_rental_id
    FROM rentals r
    WHERE r.customer_id = payment_record.customer_id
      AND r.vehicle_id = payment_record.vehicle_id
      AND r.status = 'Active'
      AND r.start_date <= payment_record.payment_date
      AND (r.end_date IS NULL OR r.end_date >= payment_record.payment_date)
    ORDER BY r.created_at DESC
    LIMIT 1;
    
    IF found_rental_id IS NOT NULL THEN
      -- Update the payment with the found rental_id
      UPDATE payments 
      SET rental_id = found_rental_id 
      WHERE id = payment_record.id;
      
      updated_count := updated_count + 1;
    ELSE
      skipped_count := skipped_count + 1;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT updated_count, skipped_count;
END;
$$;