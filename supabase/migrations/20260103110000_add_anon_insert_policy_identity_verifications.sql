-- Add INSERT policy for anon on identity_verifications
-- This allows the booking flow to create verification records before opening Veriff

-- First, check if the policy exists and drop it if so (to make migration idempotent)
DROP POLICY IF EXISTS "Allow anon to create verifications for booking" ON "public"."identity_verifications";

-- Create INSERT policy for anon
-- Only allows inserting records with status='pending' and no customer_id (booking flow)
CREATE POLICY "Allow anon to create verifications for booking" 
ON "public"."identity_verifications" 
FOR INSERT 
TO "anon" 
WITH CHECK (
  status = 'pending' 
  AND customer_id IS NULL
);

-- Add comment explaining the policy
COMMENT ON POLICY "Allow anon to create verifications for booking" ON "public"."identity_verifications" 
IS 'Allows anonymous users (booking website) to create pending verification records before initiating Veriff flow';
