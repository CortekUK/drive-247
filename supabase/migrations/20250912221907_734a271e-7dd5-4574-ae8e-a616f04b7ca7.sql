-- Fix security warnings by adding search_path to all functions

-- Update generate_monthly_charges function
CREATE OR REPLACE FUNCTION public.generate_monthly_charges(rental_id UUID)
RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    rental_record RECORD;
    current_month INTEGER := 0;
    due_date DATE;
BEGIN
    -- Get rental details
    SELECT * INTO rental_record FROM public.rentals WHERE id = rental_id;
    
    -- Generate charges for each month
    WHILE current_month < rental_record.duration_months LOOP
        due_date := rental_record.start_date + INTERVAL '1 month' * current_month;
        
        -- Insert monthly payment due
        INSERT INTO public.payments (
            rental_id, customer_id, vehicle_id, amount, type, status, due_date
        ) VALUES (
            rental_id, rental_record.customer_id, rental_record.vehicle_id,
            rental_record.monthly_payment, 'monthly', 'due', due_date
        );
        
        -- Insert ledger entry
        INSERT INTO public.ledger (
            customer_id, rental_id, vehicle_id, entry_type, description, amount, status
        ) VALUES (
            rental_record.customer_id, rental_id, rental_record.vehicle_id,
            'charge', 'Monthly rental charge for ' || to_char(due_date, 'Month YYYY'),
            rental_record.monthly_payment, 'applied'
        );
        
        current_month := current_month + 1;
    END LOOP;
END;
$$;

-- Update apply_payment function
CREATE OR REPLACE FUNCTION public.apply_payment(payment_id UUID)
RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    payment_record RECORD;
    remaining_amount NUMERIC;
    due_payment RECORD;
BEGIN
    -- Get payment details
    SELECT * INTO payment_record FROM public.payments WHERE id = payment_id;
    remaining_amount := payment_record.amount;
    
    -- Apply payment to oldest due charges first (FIFO)
    FOR due_payment IN 
        SELECT * FROM public.payments 
        WHERE customer_id = payment_record.customer_id 
        AND status IN ('due', 'overdue')
        AND type = 'monthly'
        ORDER BY due_date ASC
    LOOP
        IF remaining_amount <= 0 THEN
            EXIT;
        END IF;
        
        IF remaining_amount >= due_payment.amount THEN
            -- Full payment of this due amount
            UPDATE public.payments 
            SET status = 'paid', paid_date = now()
            WHERE id = due_payment.id;
            
            remaining_amount := remaining_amount - due_payment.amount;
        END IF;
    END LOOP;
    
    -- Update payment status
    UPDATE public.payments 
    SET status = 'paid', paid_date = now()
    WHERE id = payment_id;
    
    -- Update customer balance and vehicle P&L
    PERFORM public.update_customer_balance(payment_record.customer_id);
    PERFORM public.recalculate_vehicle_pl(payment_record.vehicle_id);
END;
$$;

-- Update recalculate_vehicle_pl function
CREATE OR REPLACE FUNCTION public.recalculate_vehicle_pl(vehicle_id UUID)
RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    vehicle_record RECORD;
    total_rev NUMERIC := 0;
    total_cost NUMERIC := 0;
BEGIN
    -- Get vehicle acquisition cost
    SELECT * INTO vehicle_record FROM public.vehicles WHERE id = vehicle_id;
    total_cost := vehicle_record.acquisition_price;
    
    -- Calculate total revenue from all sources
    SELECT COALESCE(SUM(amount), 0) INTO total_rev
    FROM public.ledger 
    WHERE vehicle_id = vehicle_id AND entry_type = 'charge' AND status = 'applied';
    
    -- Add initial fees from rentals
    SELECT COALESCE(SUM(initial_payment), 0) INTO total_rev
    FROM public.rentals 
    WHERE vehicle_id = vehicle_id;
    
    -- Upsert P&L record
    INSERT INTO public.p_l (vehicle_id, total_revenue, total_costs, updated_at)
    VALUES (vehicle_id, total_rev, total_cost, now())
    ON CONFLICT (vehicle_id) 
    DO UPDATE SET 
        total_revenue = EXCLUDED.total_revenue,
        total_costs = EXCLUDED.total_costs,
        updated_at = now();
END;
$$;

-- Update update_customer_balance function
CREATE OR REPLACE FUNCTION public.update_customer_balance(customer_id UUID)
RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    total_due NUMERIC := 0;
    total_paid NUMERIC := 0;
    new_balance NUMERIC;
BEGIN
    -- Calculate total due (due + overdue)
    SELECT COALESCE(SUM(amount), 0) INTO total_due
    FROM public.payments 
    WHERE customer_id = customer_id 
    AND status IN ('due', 'overdue')
    AND due_date <= CURRENT_DATE;
    
    -- Calculate total paid
    SELECT COALESCE(SUM(amount), 0) INTO total_paid
    FROM public.payments 
    WHERE customer_id = customer_id 
    AND status = 'paid';
    
    -- Update customer balance
    new_balance := total_due - total_paid;
    
    UPDATE public.customers 
    SET balance = new_balance 
    WHERE id = customer_id;
END;
$$;

-- Update trigger functions
CREATE OR REPLACE FUNCTION public.create_vehicle_pl()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.p_l (vehicle_id, total_revenue, total_costs)
    VALUES (NEW.id, 0, NEW.acquisition_price);
    RETURN NEW;
END;
$$;

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