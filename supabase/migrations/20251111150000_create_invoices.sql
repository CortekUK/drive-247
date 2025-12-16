-- Create invoices table
CREATE TABLE IF NOT EXISTS invoices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    rental_id UUID REFERENCES rentals(id) ON DELETE CASCADE NOT NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    invoice_number TEXT UNIQUE NOT NULL,
    invoice_date DATE NOT NULL,
    due_date DATE,
    subtotal NUMERIC(10,2) NOT NULL,
    tax_amount NUMERIC(10,2) DEFAULT 0,
    total_amount NUMERIC(10,2) NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_invoices_rental ON invoices(rental_id);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_vehicle ON invoices(vehicle_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_date ON invoices(invoice_date);

-- Enable RLS
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users to view invoices
CREATE POLICY "Allow authenticated users to view invoices"
    ON invoices FOR SELECT
    TO authenticated
    USING (true);

-- Create policy for authenticated users to manage invoices
CREATE POLICY "Allow authenticated users to manage invoices"
    ON invoices FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Add comments
COMMENT ON TABLE invoices IS 'Stores rental invoices';
COMMENT ON COLUMN invoices.invoice_number IS 'Unique invoice identifier';
COMMENT ON COLUMN invoices.invoice_date IS 'Date when invoice was generated';
COMMENT ON COLUMN invoices.due_date IS 'Payment due date';
COMMENT ON COLUMN invoices.subtotal IS 'Subtotal before tax';
COMMENT ON COLUMN invoices.tax_amount IS 'Tax amount';
COMMENT ON COLUMN invoices.total_amount IS 'Total amount including tax';
COMMENT ON COLUMN invoices.status IS 'Invoice payment status';
