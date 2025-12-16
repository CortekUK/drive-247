-- Fix RLS policies on reminders table to allow anonymous read access
-- Drop all existing policies first
DROP POLICY IF EXISTS "Allow anonymous users to read reminders" ON public.reminders;
DROP POLICY IF EXISTS "Allow authenticated users full access to reminders" ON public.reminders;
DROP POLICY IF EXISTS "Enable all operations for authenticated users - reminders" ON public.reminders;

-- Create new policy allowing anonymous users to read reminders
CREATE POLICY "Allow all users to read reminders" 
ON public.reminders 
FOR SELECT 
USING (true);

-- Create policy for authenticated users to modify reminders
CREATE POLICY "Allow authenticated users to modify reminders" 
ON public.reminders 
FOR INSERT, UPDATE, DELETE
TO authenticated 
USING (true) 
WITH CHECK (true);