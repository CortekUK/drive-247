-- Add disposal fields to vehicles table
ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS is_disposed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS disposal_date date,
ADD COLUMN IF NOT EXISTS sale_proceeds numeric,
ADD COLUMN IF NOT EXISTS disposal_buyer text,
ADD COLUMN IF NOT EXISTS disposal_notes text;

-- Add unique constraint on pnl_entries reference if not exists
CREATE UNIQUE INDEX IF NOT EXISTS idx_pnl_entries_reference_unique 
ON public.pnl_entries(reference) 
WHERE reference IS NOT NULL;

-- Create function to calculate book cost for disposal
CREATE OR REPLACE FUNCTION public.calculate_vehicle_book_cost(p_vehicle_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_vehicle RECORD;
  v_book_cost numeric := 0;
BEGIN
  SELECT acquisition_type, purchase_price, initial_payment, monthly_payment, term_months, balloon
  INTO v_vehicle
  FROM vehicles
  WHERE id = p_vehicle_id;
  
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  
  CASE v_vehicle.acquisition_type
    WHEN 'Purchase' THEN
      v_book_cost := COALESCE(v_vehicle.purchase_price, 0);
    WHEN 'Finance' THEN
      v_book_cost := COALESCE(v_vehicle.initial_payment, 0) + 
                    (COALESCE(v_vehicle.monthly_payment, 0) * COALESCE(v_vehicle.term_months, 0)) + 
                    COALESCE(v_vehicle.balloon, 0);
    ELSE
      v_book_cost := COALESCE(v_vehicle.purchase_price, 0);
  END CASE;
  
  RETURN v_book_cost;
END;
$$;

-- Create function to process vehicle disposal
CREATE OR REPLACE FUNCTION public.dispose_vehicle(
  p_vehicle_id uuid,
  p_disposal_date date,
  p_sale_proceeds numeric,
  p_buyer text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_book_cost numeric;
  v_result numeric;
  v_side text;
  v_amount numeric;
  v_reference text;
BEGIN
  -- Calculate book cost
  v_book_cost := calculate_vehicle_book_cost(p_vehicle_id);
  
  -- Calculate gain/loss
  v_result := p_sale_proceeds - v_book_cost;
  v_reference := 'dispose:' || p_vehicle_id::text;
  
  -- Update vehicle with disposal info
  UPDATE vehicles 
  SET is_disposed = true,
      disposal_date = p_disposal_date,
      sale_proceeds = p_sale_proceeds,
      disposal_buyer = p_buyer,
      disposal_notes = p_notes,
      status = 'Disposed'
  WHERE id = p_vehicle_id;
  
  -- Insert P&L entry only if there's a gain or loss
  IF v_result != 0 THEN
    IF v_result > 0 THEN
      v_side := 'Revenue';
      v_amount := v_result;
    ELSE
      v_side := 'Cost';
      v_amount := ABS(v_result);
    END IF;
    
    INSERT INTO pnl_entries (
      vehicle_id, entry_date, side, category, amount, reference
    ) VALUES (
      p_vehicle_id, p_disposal_date, v_side, 'Disposal', v_amount, v_reference
    )
    ON CONFLICT (reference) DO UPDATE SET
      entry_date = EXCLUDED.entry_date,
      side = EXCLUDED.side,
      amount = EXCLUDED.amount;
  END IF;
  
  -- Add vehicle event
  INSERT INTO vehicle_events (
    vehicle_id, event_type, summary, event_date
  ) VALUES (
    p_vehicle_id, 
    'disposal', 
    'Vehicle disposed for £' || p_sale_proceeds || 
    CASE WHEN v_result > 0 THEN ' (Gain: £' || v_result || ')'
         WHEN v_result < 0 THEN ' (Loss: £' || ABS(v_result) || ')'
         ELSE ' (Break-even)'
    END,
    p_disposal_date
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'book_cost', v_book_cost,
    'sale_proceeds', p_sale_proceeds,
    'gain_loss', v_result
  );
END;
$$;

-- Create function to undo vehicle disposal
CREATE OR REPLACE FUNCTION public.undo_vehicle_disposal(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER  
SET search_path = 'public'
AS $$
DECLARE
  v_reference text;
BEGIN
  v_reference := 'dispose:' || p_vehicle_id::text;
  
  -- Remove disposal info from vehicle
  UPDATE vehicles 
  SET is_disposed = false,
      disposal_date = NULL,
      sale_proceeds = NULL,
      disposal_buyer = NULL,
      disposal_notes = NULL,
      status = 'Available'
  WHERE id = p_vehicle_id;
  
  -- Remove P&L disposal entry
  DELETE FROM pnl_entries WHERE reference = v_reference;
  
  -- Add reversal event
  INSERT INTO vehicle_events (
    vehicle_id, event_type, summary
  ) VALUES (
    p_vehicle_id, 'disposal', 'Disposal reversed - vehicle returned to available'
  );
  
  RETURN jsonb_build_object('success', true);
END;
$$;