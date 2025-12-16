-- Insert seed data for demonstration

-- Insert demo customers
INSERT INTO public.customers (name, type, email, phone, status) VALUES
('John Smith', 'individual', 'john.smith@email.com', '+44 7700 900123', 'active'),
('Sarah Johnson', 'individual', 'sarah.johnson@email.com', '+44 7700 900124', 'active'),
('Wilson Logistics Ltd', 'company', 'accounts@wilsonlogistics.co.uk', '+44 20 7946 0958', 'active');

-- Insert demo vehicles
INSERT INTO public.vehicles (reg_number, make, model, colour, acquisition_type, acquisition_price, acquisition_date, dealer_source, status) VALUES
('AB12 CDE', 'Audi', 'A4', 'Black', 'purchase', 25000.00, '2024-01-15', 'Premium Motors Ltd', 'rented'),
('FG34 HIJ', 'BMW', '3 Series', 'Blue', 'finance', 28000.00, '2024-02-20', 'BMW Main Dealer', 'available'),
('KL56 MNO', 'Mercedes', 'C-Class', 'Silver', 'purchase', 30000.00, '2024-03-10', 'Star Motors', 'rented'),
('PQ78 RST', 'Ford', 'Transit', 'White', 'purchase', 22000.00, '2024-01-25', 'Ford Commercial', 'available'),
('UV90 WXY', 'Volkswagen', 'Golf', 'Red', 'lease', 20000.00, '2024-02-05', 'VW Dealership', 'rented');

-- Get the IDs for the inserted data (we'll use the first few)
DO $$
DECLARE
    customer1_id UUID;
    customer2_id UUID;
    customer3_id UUID;
    vehicle1_id UUID;
    vehicle2_id UUID;
    vehicle3_id UUID;
    vehicle5_id UUID;
    rental1_id UUID;
    rental2_id UUID;
    rental3_id UUID;
BEGIN
    -- Get customer IDs
    SELECT id INTO customer1_id FROM public.customers WHERE email = 'john.smith@email.com';
    SELECT id INTO customer2_id FROM public.customers WHERE email = 'sarah.johnson@email.com';
    SELECT id INTO customer3_id FROM public.customers WHERE email = 'accounts@wilsonlogistics.co.uk';
    
    -- Get vehicle IDs
    SELECT id INTO vehicle1_id FROM public.vehicles WHERE reg_number = 'AB12 CDE';
    SELECT id INTO vehicle2_id FROM public.vehicles WHERE reg_number = 'FG34 HIJ';
    SELECT id INTO vehicle3_id FROM public.vehicles WHERE reg_number = 'KL56 MNO';
    SELECT id INTO vehicle5_id FROM public.vehicles WHERE reg_number = 'UV90 WXY';
    
    -- Insert demo rentals
    INSERT INTO public.rentals (customer_id, vehicle_id, start_date, end_date, initial_payment, monthly_payment, duration_months, status) VALUES
    (customer1_id, vehicle1_id, '2024-03-01', '2024-09-01', 500.00, 450.00, 6, 'active'),
    (customer2_id, vehicle3_id, '2024-02-15', '2025-02-15', 750.00, 620.00, 12, 'active'),
    (customer3_id, vehicle5_id, '2024-01-10', '2024-07-10', 300.00, 380.00, 6, 'completed');
    
    -- Get rental IDs
    SELECT id INTO rental1_id FROM public.rentals WHERE customer_id = customer1_id AND vehicle_id = vehicle1_id;
    SELECT id INTO rental2_id FROM public.rentals WHERE customer_id = customer2_id AND vehicle_id = vehicle3_id;
    SELECT id INTO rental3_id FROM public.rentals WHERE customer_id = customer3_id AND vehicle_id = vehicle5_id;
    
    -- Insert some payment records (the triggers will have created the due payments)
    -- Let's add some actual payments to show the system working
    
    -- Payment for John Smith (first 2 months paid)
    UPDATE public.payments 
    SET status = 'paid', paid_date = '2024-03-01'
    WHERE rental_id = rental1_id AND due_date = '2024-03-01';
    
    UPDATE public.payments 
    SET status = 'paid', paid_date = '2024-04-01' 
    WHERE rental_id = rental1_id AND due_date = '2024-04-01';
    
    -- Payment for Sarah Johnson (first 3 months paid)
    UPDATE public.payments 
    SET status = 'paid', paid_date = '2024-02-15'
    WHERE rental_id = rental2_id AND due_date = '2024-02-15';
    
    UPDATE public.payments 
    SET status = 'paid', paid_date = '2024-03-15'
    WHERE rental_id = rental2_id AND due_date = '2024-03-15';
    
    UPDATE public.payments 
    SET status = 'paid', paid_date = '2024-04-15'
    WHERE rental_id = rental2_id AND due_date = '2024-04-15';
    
    -- Wilson Logistics - all payments completed (rental completed)
    UPDATE public.payments 
    SET status = 'paid', paid_date = due_date
    WHERE rental_id = rental3_id;
    
    -- Mark some payments as overdue for demonstration
    UPDATE public.payments 
    SET status = 'overdue'
    WHERE rental_id = rental1_id AND due_date <= CURRENT_DATE AND status = 'due';
    
    -- Update customer balances
    PERFORM public.update_customer_balance(customer1_id);
    PERFORM public.update_customer_balance(customer2_id);
    PERFORM public.update_customer_balance(customer3_id);
    
    -- Update all vehicle P&L
    PERFORM public.recalculate_vehicle_pl(vehicle1_id);
    PERFORM public.recalculate_vehicle_pl(vehicle2_id);
    PERFORM public.recalculate_vehicle_pl(vehicle3_id);
    PERFORM public.recalculate_vehicle_pl(vehicle5_id);
    
END $$;