-- Add RLS policy to allow anon users to update verification_step and upload_progress
-- This is needed for the mobile verification page to sync progress to the desktop

-- Drop if exists to make migration idempotent
DROP POLICY IF EXISTS "Allow anon to update verification step" ON "public"."identity_verifications";

-- Create UPDATE policy for anon to update verification progress fields
-- Only allows updating records that are not yet completed (status != 'completed')
CREATE POLICY "Allow anon to update verification step" ON "public"."identity_verifications"
FOR UPDATE TO "anon"
USING (status != 'completed')
WITH CHECK (status != 'completed');

COMMENT ON POLICY "Allow anon to update verification step" ON "public"."identity_verifications"
IS 'Allows anonymous users (mobile verification page) to update verification_step and upload_progress for real-time sync with desktop';
