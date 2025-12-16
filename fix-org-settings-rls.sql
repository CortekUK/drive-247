-- Fix RLS policies for org_settings table
-- This resolves the PGRST301 error

-- Drop existing policies
DROP POLICY IF EXISTS "Allow all operations for app users" ON org_settings;
DROP POLICY IF EXISTS "Enable read access for all users" ON org_settings;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON org_settings;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON org_settings;

-- Create new permissive policy that allows all operations for authenticated users
CREATE POLICY "Allow authenticated users full access to org_settings"
ON org_settings
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Also allow anon users to read (for edge functions using anon key)
CREATE POLICY "Allow anon users read access to org_settings"
ON org_settings
FOR SELECT
TO anon
USING (true);

-- Verify RLS is enabled
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'org_settings';
