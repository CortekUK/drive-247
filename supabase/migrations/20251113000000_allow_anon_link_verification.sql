-- Allow anonymous users to link verification to customer
-- This policy allows the booking flow to update customer_id on verification records
-- ONLY when customer_id is currently NULL (i.e., linking for the first time)

CREATE POLICY "Allow anon to link verification to customer"
  ON identity_verifications
  FOR UPDATE
  TO anon
  USING (customer_id IS NULL) -- Can only update if customer_id is currently NULL
  WITH CHECK (customer_id IS NOT NULL); -- Can only set customer_id to a non-NULL value

-- Also allow anon to read verifications for the booking flow
CREATE POLICY "Allow anon to read verifications for booking"
  ON identity_verifications
  FOR SELECT
  TO anon
  USING (true);
