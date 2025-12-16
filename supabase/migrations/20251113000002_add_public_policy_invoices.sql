-- Add public policy for invoices
-- This allows anonymous users (on client-side booking) to view and create invoices

-- Allow public to view invoices (needed for generating invoice numbers)
CREATE POLICY "Allow public to view invoices"
    ON invoices FOR SELECT
    TO anon, public
    USING (true);

-- Allow public to create invoices during booking
CREATE POLICY "Allow public to create invoices"
    ON invoices FOR INSERT
    TO anon, public
    WITH CHECK (true);

-- Update comment
COMMENT ON TABLE invoices IS 'Stores rental invoices. Authenticated users can manage all invoices, public can view and create invoices during booking.';
