-- Check and fix fine charge creation workflow

-- Ensure fine charges are properly created with the correct category
CREATE OR REPLACE FUNCTION public.trigger_create_fine_charge()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only create charge if liability is Customer and customer is assigned
  IF NEW.liability = 'Customer' AND NEW.customer_id IS NOT NULL THEN
    -- Create fine charge using ledger_entries directly with proper category
    INSERT INTO public.ledger_entries (
      customer_id, 
      vehicle_id, 
      entry_date, 
      due_date, 
      type, 
      category, 
      amount, 
      remaining_amount,
      reference
    ) VALUES (
      NEW.customer_id,
      NEW.vehicle_id,
      NEW.issue_date,
      NEW.due_date,
      'Charge',
      'Fines',  -- Important: use 'Fines' category for proper FIFO allocation
      NEW.amount,
      NEW.amount,
      CONCAT('FINE-', NEW.id)
    );
  END IF;
  
  -- If liability is Business, create P&L cost entry immediately
  IF NEW.liability = 'Business' THEN
    INSERT INTO pnl_entries(
      vehicle_id, 
      entry_date, 
      side, 
      category, 
      amount, 
      source_ref,
      customer_id
    )
    VALUES (
      NEW.vehicle_id, 
      NEW.issue_date, 
      'Cost', 
      'Fines', 
      NEW.amount, 
      NEW.id::text,
      NEW.customer_id
    )
    ON CONFLICT (vehicle_id, category, source_ref) DO UPDATE SET
      amount = EXCLUDED.amount,
      entry_date = EXCLUDED.entry_date;
  END IF;
  
  RETURN NEW;
END $$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS fine_create_charge_trigger ON public.fines;
CREATE TRIGGER fine_create_charge_trigger
  AFTER INSERT ON public.fines
  FOR EACH ROW EXECUTE FUNCTION public.trigger_create_fine_charge();