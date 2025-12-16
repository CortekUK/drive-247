-- Fix RLS policies to allow anonymous access for the fines table
-- Drop existing policies and recreate with proper anon access

-- First check and update fines table policy
DO $$
BEGIN
    -- Drop existing policy if it exists
    DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.fines;
    DROP POLICY IF EXISTS "Allow all operations for app users" ON public.fines;
    
    -- Create new policy that allows anon access
    CREATE POLICY "Allow anon access for fines" ON public.fines
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
      
    -- Also create service_role policy for admin operations
    CREATE POLICY "Allow service role access for fines" ON public.fines
      FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION
    WHEN duplicate_object THEN
        -- Policy already exists, just ignore
        NULL;
END
$$;