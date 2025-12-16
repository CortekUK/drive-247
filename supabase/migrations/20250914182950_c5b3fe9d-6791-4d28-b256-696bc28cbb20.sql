-- Let's check current policies and modify them
-- First drop all existing reminder policies to start fresh
DROP POLICY "Allow all users to read reminders" ON reminders;
DROP POLICY "Enable all operations for all users - reminders update" ON reminders;
DROP POLICY "Enable all operations for all users - reminders delete" ON reminders;  
DROP POLICY "Enable all operations for all users - reminders insert" ON reminders;

-- Create comprehensive policies for all operations
CREATE POLICY "Allow all operations on reminders" 
ON reminders 
FOR ALL
USING (true) 
WITH CHECK (true);