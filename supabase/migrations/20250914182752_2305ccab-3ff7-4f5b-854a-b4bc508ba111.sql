-- Update RLS policies for reminders table to allow anonymous users to update reminders
-- This is needed for the demo/testing environment

DROP POLICY IF EXISTS "Allow authenticated users to update reminders" ON reminders;
DROP POLICY IF EXISTS "Allow authenticated users to delete reminders" ON reminders;
DROP POLICY IF EXISTS "Allow authenticated users to insert reminders" ON reminders;

-- Allow all users (including anonymous) to perform operations on reminders
CREATE POLICY "Allow all users to update reminders" 
ON reminders 
FOR UPDATE 
USING (true) 
WITH CHECK (true);

CREATE POLICY "Allow all users to delete reminders" 
ON reminders 
FOR DELETE 
USING (true);

CREATE POLICY "Allow all users to insert reminders" 
ON reminders 
FOR INSERT 
WITH CHECK (true);