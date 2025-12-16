-- Remove custom fine functions and use existing canonical functions
DROP FUNCTION IF EXISTS public.fine_create_charge(uuid);
DROP FUNCTION IF EXISTS public.fine_apply_payment_fifo(uuid);
DROP TRIGGER IF EXISTS fine_create_charge_trigger ON public.fines;

-- Update the trigger to use existing rental_create_charge function
CREATE OR REPLACE FUNCTION public.trigger_create_fine_charge()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only create charge if liability is Customer and customer is assigned
  IF NEW.liability = 'Customer' AND NEW.customer_id IS NOT NULL THEN
    PERFORM rental_create_charge(NEW.id, NEW.due_date, NEW.amount);
  END IF;
  
  -- If liability is Business, create P&L cost entry
  IF NEW.liability = 'Business' THEN
    INSERT INTO pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (NEW.vehicle_id, NEW.issue_date, 'Cost', 'Fines', NEW.amount, NEW.id::text);
  END IF;
  
  RETURN NEW;
END $$;

-- Recreate the trigger
CREATE TRIGGER fine_create_charge_trigger
  AFTER INSERT ON public.fines
  FOR EACH ROW EXECUTE FUNCTION public.trigger_create_fine_charge();

-- Update rental_create_charge to handle both rentals and fines
CREATE OR REPLACE FUNCTION public.rental_create_charge(r_id uuid, due date, amt numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE 
  rc record; 
  fc record;
  cid uuid;
BEGIN
  -- First try to get from rentals table
  SELECT * INTO rc FROM rentals WHERE id = r_id;
  
  -- If not found in rentals, try fines table
  IF NOT FOUND THEN
    SELECT 
      id,
      customer_id,
      vehicle_id,
      issue_date as start_date,
      'Fine' as category
    INTO fc 
    FROM fines 
    WHERE id = r_id;
    
    IF FOUND THEN
      INSERT INTO ledger_entries(customer_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount)
      VALUES(fc.customer_id, fc.vehicle_id, due, 'Charge', 'Fine', amt, due, amt)
      RETURNING id INTO cid;
    END IF;
  ELSE
    -- Handle rental charge
    INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount)
    VALUES(rc.customer_id, rc.id, rc.vehicle_id, due, 'Charge', 'Rental', amt, due, amt)
    RETURNING id INTO cid;
  END IF;
  
  RETURN cid;
END $$;