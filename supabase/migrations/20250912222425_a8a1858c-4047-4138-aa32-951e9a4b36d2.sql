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