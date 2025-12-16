-- Fix RLS policies for insurance_policies table
-- Drop existing restrictive policy
DROP POLICY IF EXISTS "Allow all operations for app users on insurance_policies" ON insurance_policies;

-- Create new policy that allows operations for service role and anon users
CREATE POLICY "Enable all operations for insurance_policies" ON insurance_policies
FOR ALL USING (true) WITH CHECK (true);

-- Ensure RLS is enabled
ALTER TABLE insurance_policies ENABLE ROW LEVEL SECURITY;

-- Also fix insurance_documents table policies
DROP POLICY IF EXISTS "Allow all operations for app users on insurance_documents" ON insurance_documents;

CREATE POLICY "Enable all operations for insurance_documents" ON insurance_documents
FOR ALL USING (true) WITH CHECK (true);

-- Ensure RLS is enabled for insurance_documents
ALTER TABLE insurance_documents ENABLE ROW LEVEL SECURITY;