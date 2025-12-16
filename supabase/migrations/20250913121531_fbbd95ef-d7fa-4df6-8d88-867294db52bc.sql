-- Add apply_payments_to_charges function for automatic FIFO payment application
CREATE OR REPLACE FUNCTION public.apply_payments_to_charges(p_rental_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  p RECORD;
  c RECORD;
  v_left NUMERIC;
  to_apply NUMERIC;
BEGIN
  -- Apply all unapplied rental payments for the specified rental (or all if NULL)
  FOR p IN
    SELECT id, amount, rental_id, customer_id, vehicle_id, payment_date
    FROM payments 
    WHERE payment_type = 'Rental'
      AND status IN ('Applied', 'Credit', 'Partial')
      AND (p_rental_id IS NULL OR rental_id = p_rental_id)
    ORDER BY payment_date ASC, id ASC
  LOOP
    -- Calculate remaining amount for this payment
    SELECT COALESCE(p.amount - SUM(pa.amount_applied), p.amount) INTO v_left
    FROM payment_applications pa
    WHERE pa.payment_id = p.id;
    
    -- Skip if payment is fully applied
    CONTINUE WHEN v_left <= 0;
    
    -- Apply to charges FIFO (due date, then entry date)
    FOR c IN
      SELECT id, remaining_amount, due_date
      FROM ledger_entries
      WHERE customer_id = p.customer_id
        AND type = 'Charge' 
        AND category = 'Rental'
        AND remaining_amount > 0
        AND (p_rental_id IS NULL OR rental_id = p_rental_id)
        AND due_date <= CURRENT_DATE -- Only apply to charges that are due
      ORDER BY due_date ASC, entry_date ASC, id ASC
    LOOP
      EXIT WHEN v_left <= 0;
      
      to_apply := LEAST(c.remaining_amount, v_left);
      
      -- Insert payment application
      INSERT INTO payment_applications(payment_id, charge_entry_id, amount_applied)
      VALUES (p.id, c.id, to_apply)
      ON CONFLICT ON CONSTRAINT ux_payment_app_unique DO NOTHING;
      
      -- Update ledger entry remaining amount
      UPDATE ledger_entries
      SET remaining_amount = remaining_amount - to_apply
      WHERE id = c.id;
      
      -- Book revenue on the charge due date
      INSERT INTO pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
      VALUES (p.vehicle_id, c.due_date, 'Revenue', 'Rental', to_apply, p.id::text)
      ON CONFLICT ON CONSTRAINT ux_pnl_vehicle_category_source DO NOTHING;
      
      v_left := v_left - to_apply;
    END LOOP;
    
    -- Update payment status
    IF v_left = 0 THEN
      UPDATE payments SET status = 'Applied', remaining_amount = 0 WHERE id = p.id;
    ELSIF v_left = p.amount THEN
      UPDATE payments SET status = 'Credit', remaining_amount = v_left WHERE id = p.id;
    ELSE
      UPDATE payments SET status = 'Partial', remaining_amount = v_left WHERE id = p.id;
    END IF;
  END LOOP;
END;
$function$;

-- Add trigger for automatic payment application on payment insert
CREATE OR REPLACE FUNCTION public.trigger_apply_payments_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Only apply rental payments automatically
  IF NEW.payment_type = 'Rental' THEN
    PERFORM apply_payments_to_charges(NEW.rental_id);
  END IF;
  RETURN NEW;
END;
$function$;

-- Add trigger for automatic payment application on charge insert
CREATE OR REPLACE FUNCTION public.trigger_apply_payments_on_charge()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Only trigger on rental charges
  IF NEW.type = 'Charge' AND NEW.category = 'Rental' THEN
    PERFORM apply_payments_to_charges(NEW.rental_id);
  END IF;
  RETURN NEW;
END;
$function$;

-- Create triggers
DROP TRIGGER IF EXISTS trigger_payments_auto_apply ON payments;
CREATE TRIGGER trigger_payments_auto_apply
  AFTER INSERT ON payments
  FOR EACH ROW
  EXECUTE FUNCTION trigger_apply_payments_on_insert();

DROP TRIGGER IF EXISTS trigger_charges_auto_apply ON ledger_entries;
CREATE TRIGGER trigger_charges_auto_apply
  AFTER INSERT ON ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION trigger_apply_payments_on_charge();

-- Update Initial Fee P&L category to match requirements
UPDATE pnl_entries 
SET category = 'InitialFees' 
WHERE category = 'Fees' AND side = 'Revenue';

-- Ensure unique constraint exists for rental charges
CREATE UNIQUE INDEX IF NOT EXISTS ux_rental_charge_unique
ON public.ledger_entries (rental_id, due_date)
WHERE type='Charge' AND category='Rental' AND rental_id IS NOT NULL;