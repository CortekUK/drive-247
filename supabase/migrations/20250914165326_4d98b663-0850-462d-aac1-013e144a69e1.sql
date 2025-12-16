-- Update RLS policy on reminders table to allow anonymous access for reading
-- This is needed because the frontend app runs as anonymous user but needs to read reminders

-- Drop existing restrictive policy
DROP POLICY IF EXISTS "Enable all operations for authenticated users - reminders" ON public.reminders;

-- Create new policies that allow anonymous access for SELECT operations
-- and authenticated users for all operations
CREATE POLICY "Allow anonymous users to read reminders" 
ON public.reminders 
FOR SELECT 
USING (true);

CREATE POLICY "Allow authenticated users full access to reminders" 
ON public.reminders 
FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);