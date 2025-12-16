-- Fix vehicle color column issue (vehicles table has both colour and color columns)
-- Remove the duplicate color column since colour is the main one being used
ALTER TABLE vehicles DROP COLUMN IF EXISTS color;

-- Fix constraint issue for rental charges
DROP INDEX IF EXISTS ux_rental_charge_unique;
CREATE UNIQUE INDEX IF NOT EXISTS ux_rental_charge_unique 
ON ledger_entries (rental_id, due_date) 
WHERE type = 'Charge' AND category = 'Rental';

-- Add RLS policy for rentals if not exists
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON rentals;
CREATE POLICY "Allow all operations for authenticated users" 
ON rentals FOR ALL 
USING (true);