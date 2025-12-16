-- Fix search path security for the newly created functions
CREATE OR REPLACE FUNCTION public.update_vehicle_last_service(p_vehicle_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  latest_service RECORD;
BEGIN
  -- Get the most recent service record for this vehicle
  SELECT service_date, mileage 
  INTO latest_service
  FROM service_records 
  WHERE vehicle_id = p_vehicle_id 
  ORDER BY service_date DESC, created_at DESC 
  LIMIT 1;
  
  IF FOUND THEN
    -- Update vehicle with latest service info
    UPDATE vehicles 
    SET last_service_date = latest_service.service_date,
        last_service_mileage = latest_service.mileage
    WHERE id = p_vehicle_id;
  ELSE
    -- No service records, clear the fields
    UPDATE vehicles 
    SET last_service_date = NULL,
        last_service_mileage = NULL
    WHERE id = p_vehicle_id;
  END IF;
END;
$$;

-- Fix search path security for upsert service P&L function
CREATE OR REPLACE FUNCTION public.upsert_service_pnl_entry(
  p_service_record_id uuid,
  p_cost numeric,
  p_service_date date,
  p_vehicle_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reference text;
BEGIN
  v_reference := 'service:' || p_service_record_id::text;
  
  IF p_cost > 0 THEN
    -- Insert or update P&L entry for service cost
    INSERT INTO pnl_entries (
      vehicle_id, entry_date, side, category, amount, reference
    )
    VALUES (
      p_vehicle_id, p_service_date, 'Cost', 'Service', p_cost, v_reference
    )
    ON CONFLICT (reference) 
    DO UPDATE SET 
      amount = EXCLUDED.amount,
      entry_date = EXCLUDED.entry_date,
      vehicle_id = EXCLUDED.vehicle_id;
  ELSE
    -- Remove P&L entry if cost is 0 or negative
    DELETE FROM pnl_entries WHERE reference = v_reference;
  END IF;
END;
$$;

-- Fix search path security for trigger function
CREATE OR REPLACE FUNCTION public.trigger_update_vehicle_last_service()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Handle INSERT and UPDATE
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM update_vehicle_last_service(NEW.vehicle_id);
    
    -- Handle P&L entry for service cost
    PERFORM upsert_service_pnl_entry(
      NEW.id, NEW.cost, NEW.service_date, NEW.vehicle_id
    );
    
    RETURN NEW;
  END IF;
  
  -- Handle DELETE
  IF TG_OP = 'DELETE' THEN
    PERFORM update_vehicle_last_service(OLD.vehicle_id);
    
    -- Remove P&L entry
    DELETE FROM pnl_entries 
    WHERE reference = 'service:' || OLD.id::text;
    
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$;