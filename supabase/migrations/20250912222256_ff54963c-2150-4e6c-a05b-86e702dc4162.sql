-- Fix the recalculate_vehicle_pl function with proper column references
CREATE OR REPLACE FUNCTION public.recalculate_vehicle_pl(p_vehicle_id UUID)
RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    vehicle_record RECORD;
    total_rev NUMERIC := 0;
    total_cost NUMERIC := 0;
    ledger_revenue NUMERIC := 0;
    rental_revenue NUMERIC := 0;
BEGIN
    -- Get vehicle acquisition cost
    SELECT * INTO vehicle_record FROM public.vehicles WHERE id = p_vehicle_id;
    total_cost := vehicle_record.acquisition_price;
    
    -- Calculate total revenue from ledger entries
    SELECT COALESCE(SUM(amount), 0) INTO ledger_revenue
    FROM public.ledger 
    WHERE ledger.vehicle_id = p_vehicle_id AND entry_type = 'charge' AND status = 'applied';
    
    -- Add initial fees from rentals
    SELECT COALESCE(SUM(initial_payment), 0) INTO rental_revenue
    FROM public.rentals 
    WHERE rentals.vehicle_id = p_vehicle_id;
    
    total_rev := ledger_revenue + rental_revenue;
    
    -- Upsert P&L record
    INSERT INTO public.p_l (vehicle_id, total_revenue, total_costs, updated_at)
    VALUES (p_vehicle_id, total_rev, total_cost, now())
    ON CONFLICT (vehicle_id) 
    DO UPDATE SET 
        total_revenue = EXCLUDED.total_revenue,
        total_costs = EXCLUDED.total_costs,
        updated_at = now();
END;
$$;

-- Update the trigger function to use the corrected function name
CREATE OR REPLACE FUNCTION public.create_rental_charges()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Add initial fee to ledger as revenue
    INSERT INTO public.ledger (
        customer_id, rental_id, vehicle_id, entry_type, description, amount, status
    ) VALUES (
        NEW.customer_id, NEW.id, NEW.vehicle_id,
        'charge', 'Initial rental fee', NEW.initial_payment, 'applied'
    );
    
    -- Generate monthly charges
    PERFORM public.generate_monthly_charges(NEW.id);
    
    -- Update vehicle P&L
    PERFORM public.recalculate_vehicle_pl(NEW.vehicle_id);
    
    RETURN NEW;
END;
$$;