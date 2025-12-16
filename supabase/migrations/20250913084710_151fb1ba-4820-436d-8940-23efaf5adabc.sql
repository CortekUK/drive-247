-- Fix the trigger to prevent duplicate P&L entries
-- The trigger should only call pnl_post_acquisition when purchase_price or acquisition_date actually change

DROP TRIGGER IF EXISTS vehicle_acquisition_trigger ON vehicles;

CREATE OR REPLACE FUNCTION public.trigger_post_acquisition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- For INSERT: call if both purchase_price and acquisition_date are present
  IF TG_OP = 'INSERT' THEN
    IF NEW.purchase_price IS NOT NULL AND NEW.acquisition_date IS NOT NULL THEN
      PERFORM pnl_post_acquisition(NEW.id);
    END IF;
    RETURN NEW;
  END IF;
  
  -- For UPDATE: only call if purchase_price or acquisition_date actually changed
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.purchase_price IS DISTINCT FROM NEW.purchase_price OR 
        OLD.acquisition_date IS DISTINCT FROM NEW.acquisition_date) AND
       NEW.purchase_price IS NOT NULL AND NEW.acquisition_date IS NOT NULL THEN
      PERFORM pnl_post_acquisition(NEW.id);
    END IF;
    RETURN NEW;
  END IF;
  
  RETURN NEW;
END $function$;

-- Recreate the trigger
CREATE TRIGGER vehicle_acquisition_trigger
  AFTER INSERT OR UPDATE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_post_acquisition();