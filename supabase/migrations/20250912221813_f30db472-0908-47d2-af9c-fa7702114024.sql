-- Create enums
CREATE TYPE acquisition_type AS ENUM ('purchase', 'finance', 'lease');
CREATE TYPE vehicle_status AS ENUM ('available', 'rented', 'sold');
CREATE TYPE customer_type AS ENUM ('individual', 'company');
CREATE TYPE customer_status AS ENUM ('active', 'inactive');
CREATE TYPE rental_status AS ENUM ('active', 'completed', 'cancelled');
CREATE TYPE payment_type AS ENUM ('initial_fee', 'monthly', 'fine', 'service', 'other');
CREATE TYPE payment_status AS ENUM ('paid', 'due', 'overdue', 'void');
CREATE TYPE entry_type AS ENUM ('charge', 'payment', 'adjustment');
CREATE TYPE ledger_status AS ENUM ('pending', 'applied');

-- Vehicles table
CREATE TABLE public.vehicles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    reg_number TEXT UNIQUE NOT NULL,
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    colour TEXT NOT NULL,
    acquisition_type acquisition_type NOT NULL,
    acquisition_price NUMERIC(12,2) NOT NULL,
    acquisition_date DATE NOT NULL,
    dealer_source TEXT,
    status vehicle_status DEFAULT 'available',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Customers table  
CREATE TABLE public.customers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    type customer_type NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    balance NUMERIC(12,2) DEFAULT 0,
    status customer_status DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Rentals table
CREATE TABLE public.rentals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id UUID REFERENCES public.customers(id) NOT NULL,
    vehicle_id UUID REFERENCES public.vehicles(id) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    initial_payment NUMERIC(12,2) NOT NULL,
    monthly_payment NUMERIC(12,2) NOT NULL,
    duration_months INTEGER NOT NULL,
    status rental_status DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Payments table
CREATE TABLE public.payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    rental_id UUID REFERENCES public.rentals(id) NOT NULL,
    customer_id UUID REFERENCES public.customers(id) NOT NULL,
    vehicle_id UUID REFERENCES public.vehicles(id) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    type payment_type NOT NULL,
    status payment_status NOT NULL,
    due_date DATE NOT NULL,
    paid_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Ledger table
CREATE TABLE public.ledger (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id UUID REFERENCES public.customers(id),
    rental_id UUID REFERENCES public.rentals(id),
    vehicle_id UUID REFERENCES public.vehicles(id),
    entry_type entry_type NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    status ledger_status DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- P&L table
CREATE TABLE public.p_l (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES public.vehicles(id) UNIQUE NOT NULL,
    total_revenue NUMERIC(12,2) DEFAULT 0,
    total_costs NUMERIC(12,2) DEFAULT 0,
    net_profit NUMERIC(12,2) GENERATED ALWAYS AS (total_revenue - total_costs) STORED,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY; 
ALTER TABLE public.rentals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p_l ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow all for authenticated users for now)
CREATE POLICY "Allow all operations for authenticated users" ON public.vehicles FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all operations for authenticated users" ON public.customers FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all operations for authenticated users" ON public.rentals FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all operations for authenticated users" ON public.payments FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all operations for authenticated users" ON public.ledger FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all operations for authenticated users" ON public.p_l FOR ALL TO authenticated USING (true);

-- Function to generate monthly charges
CREATE OR REPLACE FUNCTION public.generate_monthly_charges(rental_id UUID)
RETURNS VOID AS $$
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
$$ LANGUAGE plpgsql;

-- Function to apply payment
CREATE OR REPLACE FUNCTION public.apply_payment(payment_id UUID)
RETURNS VOID AS $$
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
$$ LANGUAGE plpgsql;

-- Function to recalculate vehicle P&L
CREATE OR REPLACE FUNCTION public.recalculate_vehicle_pl(vehicle_id UUID)
RETURNS VOID AS $$
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
$$ LANGUAGE plpgsql;

-- Function to update customer balance
CREATE OR REPLACE FUNCTION public.update_customer_balance(customer_id UUID)
RETURNS VOID AS $$
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
$$ LANGUAGE plpgsql;

-- Trigger to create P&L entry when vehicle is added
CREATE OR REPLACE FUNCTION public.create_vehicle_pl()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.p_l (vehicle_id, total_revenue, total_costs)
    VALUES (NEW.id, 0, NEW.acquisition_price);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_vehicle_pl
    AFTER INSERT ON public.vehicles
    FOR EACH ROW EXECUTE FUNCTION public.create_vehicle_pl();

-- Trigger to generate charges when rental is created
CREATE OR REPLACE FUNCTION public.create_rental_charges()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_rental_charges
    AFTER INSERT ON public.rentals
    FOR EACH ROW EXECUTE FUNCTION public.create_rental_charges();