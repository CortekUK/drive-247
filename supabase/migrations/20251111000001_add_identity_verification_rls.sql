-- Add RLS policies for identity_verifications table

-- Allow authenticated users full access to identity verifications
CREATE POLICY "Allow authenticated users full access"
  ON identity_verifications
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow service role full access (for Edge Functions)
CREATE POLICY "Allow service role full access"
  ON identity_verifications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow anon users to read identity verifications (optional - for public verification status checks)
CREATE POLICY "Allow anon users read access"
  ON identity_verifications
  FOR SELECT
  TO anon
  USING (true);
