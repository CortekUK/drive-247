-- Add service tracking fields to vehicles table
ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS last_service_date date,
ADD COLUMN IF NOT EXISTS last_service_mileage integer;

-- Create service_records table
CREATE TABLE IF NOT EXISTS public.service_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  service_date date NOT NULL,
  mileage integer NULL,
  description text NULL,
  cost numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Create index for service records by vehicle
CREATE INDEX IF NOT EXISTS idx_service_records_vehicle_id 
ON public.service_records(vehicle_id);

-- Create index for service records by date (for ordering)
CREATE INDEX IF NOT EXISTS idx_service_records_date 
ON public.service_records(service_date DESC);

-- Create unique index for P&L reference field for idempotent upserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_pnl_reference_unique 
ON public.pnl_entries(reference) WHERE reference IS NOT NULL;

-- Enable RLS on service_records table
ALTER TABLE public.service_records ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for service_records (same as other tables)
CREATE POLICY "Allow all operations for app users" 
ON public.service_records 
FOR ALL 
TO anon, authenticated 
USING (true) 
WITH CHECK (true);

-- Function to update vehicle last service from latest record
CREATE OR REPLACE FUNCTION public.update_vehicle_last_service(p_vehicle_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  latest_service RECORD;
BEGIN
  -- Get the most recent service record for this vehicle
  SELECT service_date, mileage 
  INTO latest_service
  FROM public.service_records 
  WHERE vehicle_id = p_vehicle_id 
  ORDER BY service_date DESC, created_at DESC 
  LIMIT 1;
  
  IF FOUND THEN
    -- Update vehicle with latest service info
    UPDATE public.vehicles 
    SET last_service_date = latest_service.service_date,
        last_service_mileage = latest_service.mileage
    WHERE id = p_vehicle_id;
  ELSE
    -- No service records, clear the fields
    UPDATE public.vehicles 
    SET last_service_date = NULL,
        last_service_mileage = NULL
    WHERE id = p_vehicle_id;
  END IF;
END;
$$;

-- Function to upsert service P&L entry
CREATE OR REPLACE FUNCTION public.upsert_service_pnl_entry(
  p_service_record_id uuid,
  p_cost numeric,
  p_service_date date,
  p_vehicle_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_reference text;
BEGIN
  v_reference := 'service:' || p_service_record_id::text;
  
  IF p_cost > 0 THEN
    -- Insert or update P&L entry for service cost
    INSERT INTO public.pnl_entries (
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
    DELETE FROM public.pnl_entries WHERE reference = v_reference;
  END IF;
END;
$$;

-- Trigger function to update last service automatically
CREATE OR REPLACE FUNCTION public.trigger_update_vehicle_last_service()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Handle INSERT and UPDATE
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.update_vehicle_last_service(NEW.vehicle_id);
    
    -- Handle P&L entry for service cost
    PERFORM public.upsert_service_pnl_entry(
      NEW.id, NEW.cost, NEW.service_date, NEW.vehicle_id
    );
    
    RETURN NEW;
  END IF;
  
  -- Handle DELETE
  IF TG_OP = 'DELETE' THEN
    PERFORM public.update_vehicle_last_service(OLD.vehicle_id);
    
    -- Remove P&L entry
    DELETE FROM public.pnl_entries 
    WHERE reference = 'service:' || OLD.id::text;
    
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$;

-- Create trigger on service_records
DROP TRIGGER IF EXISTS trigger_service_records_update_vehicle ON public.service_records;
CREATE TRIGGER trigger_service_records_update_vehicle
  AFTER INSERT OR UPDATE OR DELETE ON public.service_records
  FOR EACH ROW EXECUTE FUNCTION public.trigger_update_vehicle_last_service();