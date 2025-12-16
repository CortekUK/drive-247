-- Extend plates table with new columns (backward compatible)
ALTER TABLE plates 
ADD COLUMN IF NOT EXISTS supplier text,
ADD COLUMN IF NOT EXISTS order_date date,
ADD COLUMN IF NOT EXISTS cost numeric(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS status text DEFAULT 'ordered',
ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE;

-- Add check constraint for status if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'plates_status_check'
  ) THEN
    ALTER TABLE plates ADD CONSTRAINT plates_status_check 
    CHECK (status IN ('ordered', 'received', 'fitted'));
  END IF;
END $$;

-- Migrate existing assigned_vehicle_id data to vehicle_id
UPDATE plates 
SET vehicle_id = assigned_vehicle_id 
WHERE vehicle_id IS NULL AND assigned_vehicle_id IS NOT NULL;

-- Create function to handle plate P&L entries
CREATE OR REPLACE FUNCTION upsert_plate_pnl_entry(
  p_plate_id uuid,
  p_cost numeric,
  p_order_date date,
  p_vehicle_id uuid,
  p_created_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reference text;
  v_entry_date date;
BEGIN
  v_reference := 'plate:' || p_plate_id::text;
  v_entry_date := COALESCE(p_order_date, p_created_at::date);
  
  IF p_cost > 0 THEN
    -- Insert or update P&L entry for plate cost
    INSERT INTO pnl_entries (
      vehicle_id, entry_date, side, category, amount, reference
    )
    VALUES (
      p_vehicle_id, v_entry_date, 'Cost', 'Plates', p_cost, v_reference
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

-- Create trigger function for plates P&L integration
CREATE OR REPLACE FUNCTION trigger_update_plate_pnl()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Handle INSERT and UPDATE
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    -- Only process if we have a vehicle_id and cost
    IF NEW.vehicle_id IS NOT NULL THEN
      PERFORM upsert_plate_pnl_entry(
        NEW.id, NEW.cost, NEW.order_date, NEW.vehicle_id, NEW.created_at
      );
    END IF;
    
    RETURN NEW;
  END IF;
  
  -- Handle DELETE
  IF TG_OP = 'DELETE' THEN
    -- Remove P&L entry
    DELETE FROM pnl_entries 
    WHERE reference = 'plate:' || OLD.id::text;
    
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$;

-- Create trigger for plates P&L integration
DROP TRIGGER IF EXISTS trigger_plates_pnl ON plates;
CREATE TRIGGER trigger_plates_pnl
  AFTER INSERT OR UPDATE OR DELETE ON plates
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_plate_pnl();