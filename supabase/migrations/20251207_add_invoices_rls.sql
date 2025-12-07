-- Enable RLS on invoices table if not already enabled
ALTER TABLE IF EXISTS invoices ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow public insert on invoices" ON invoices;
DROP POLICY IF EXISTS "Allow public select on invoices" ON invoices;
DROP POLICY IF EXISTS "Allow public update on invoices" ON invoices;

-- Allow anyone to insert invoices (for customer bookings)
CREATE POLICY "Allow public insert on invoices"
ON invoices
FOR INSERT
TO public, anon, authenticated
WITH CHECK (true);

-- Allow anyone to read invoices
CREATE POLICY "Allow public select on invoices"
ON invoices
FOR SELECT
TO public, anon, authenticated
USING (true);

-- Allow anyone to update invoices
CREATE POLICY "Allow public update on invoices"
ON invoices
FOR UPDATE
TO public, anon, authenticated
USING (true)
WITH CHECK (true);
