-- Enhanced pnl_post_acquisition to handle both Purchase and Finance upfront accounting
CREATE OR REPLACE FUNCTION public.pnl_post_acquisition(v_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v record;
  contract_total numeric;
  entry_date_to_use date;
  reference_key text;
BEGIN
  SELECT id, acquisition_date, purchase_price, acquisition_type, 
         monthly_payment, initial_payment, term_months, balloon, finance_start_date
  INTO v
  FROM vehicles
  WHERE id = v_id;

  -- Handle Purchase acquisition (existing logic)
  IF v.acquisition_type = 'Purchase' AND v.purchase_price IS NOT NULL AND v.acquisition_date IS NOT NULL THEN
    INSERT INTO pnl_entries (vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (v.id, v.acquisition_date, 'Cost', 'Acquisition', v.purchase_price, v.id::text)
    ON CONFLICT ON CONSTRAINT ux_pnl_vehicle_category_source
    DO UPDATE SET
      entry_date = EXCLUDED.entry_date,
      amount     = EXCLUDED.amount;
    RETURN;
  END IF;

  -- Handle Finance acquisition (new upfront logic)
  IF v.acquisition_type = 'Finance' THEN
    -- Calculate contract total: initial + (monthly * term) + balloon
    contract_total := COALESCE(v.initial_payment, 0) + 
                     (COALESCE(v.monthly_payment, 0) * COALESCE(v.term_months, 0)) + 
                     COALESCE(v.balloon, 0);

    -- Use finance_start_date if available, otherwise acquisition_date, otherwise today
    entry_date_to_use := COALESCE(v.finance_start_date, v.acquisition_date, CURRENT_DATE);
    
    -- Create stable reference for upfront finance P&L entry
    reference_key := 'FIN-UPFRONT:' || v.id::text;

    -- Insert/update upfront finance acquisition cost
    INSERT INTO pnl_entries (vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (v.id, entry_date_to_use, 'Cost', 'Acquisition', contract_total, reference_key)
    ON CONFLICT (vehicle_id, category, source_ref)
    DO UPDATE SET
      entry_date = EXCLUDED.entry_date,
      amount     = EXCLUDED.amount;
      
    RETURN;
  END IF;
END;
$function$;

-- Update trigger to handle finance field changes
CREATE OR REPLACE FUNCTION public.trigger_post_acquisition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- For INSERT: call if acquisition requirements met
  IF TG_OP = 'INSERT' THEN
    IF (NEW.acquisition_type = 'Purchase' AND NEW.purchase_price IS NOT NULL AND NEW.acquisition_date IS NOT NULL) OR
       (NEW.acquisition_type = 'Finance' AND NEW.monthly_payment IS NOT NULL) THEN
      PERFORM pnl_post_acquisition(NEW.id);
    END IF;
    RETURN NEW;
  END IF;
  
  -- For UPDATE: call if relevant fields changed
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.acquisition_type IS DISTINCT FROM NEW.acquisition_type OR
        OLD.purchase_price IS DISTINCT FROM NEW.purchase_price OR 
        OLD.acquisition_date IS DISTINCT FROM NEW.acquisition_date OR
        OLD.monthly_payment IS DISTINCT FROM NEW.monthly_payment OR
        OLD.initial_payment IS DISTINCT FROM NEW.initial_payment OR
        OLD.term_months IS DISTINCT FROM NEW.term_months OR
        OLD.balloon IS DISTINCT FROM NEW.balloon OR
        OLD.finance_start_date IS DISTINCT FROM NEW.finance_start_date) THEN
      
      -- If acquisition type changed, clean up old P&L entry first
      IF OLD.acquisition_type IS DISTINCT FROM NEW.acquisition_type THEN
        -- Remove old acquisition P&L entry
        IF OLD.acquisition_type = 'Purchase' THEN
          DELETE FROM pnl_entries WHERE vehicle_id = NEW.id AND category = 'Acquisition' AND source_ref = OLD.id::text;
        ELSIF OLD.acquisition_type = 'Finance' THEN
          DELETE FROM pnl_entries WHERE vehicle_id = NEW.id AND category = 'Acquisition' AND source_ref = 'FIN-UPFRONT:' || OLD.id::text;
        END IF;
      END IF;
      
      PERFORM pnl_post_acquisition(NEW.id);
    END IF;
    RETURN NEW;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Function to check if a vehicle has upfront finance P&L entry
CREATE OR REPLACE FUNCTION public.has_upfront_finance_entry(v_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM pnl_entries 
    WHERE vehicle_id = v_id 
    AND category = 'Acquisition' 
    AND source_ref = 'FIN-UPFRONT:' || v_id::text
  );
END;
$function$;

-- Backfill upfront P&L entries for existing financed vehicles
DO $$
DECLARE
  v_rec record;
BEGIN
  FOR v_rec IN 
    SELECT id FROM vehicles 
    WHERE acquisition_type = 'Finance' 
    AND monthly_payment IS NOT NULL
  LOOP
    -- Only create if no upfront entry exists
    IF NOT has_upfront_finance_entry(v_rec.id) THEN
      PERFORM pnl_post_acquisition(v_rec.id);
    END IF;
  END LOOP;
END $$;

-- Clean up incremental finance P&L entries for vehicles that now have upfront entries
-- This prevents double-counting
DELETE FROM pnl_entries 
WHERE category = 'Finance' 
AND side = 'Cost'
AND vehicle_id IN (
  SELECT vehicle_id 
  FROM pnl_entries 
  WHERE category = 'Acquisition' 
  AND source_ref LIKE 'FIN-UPFRONT:%'
);