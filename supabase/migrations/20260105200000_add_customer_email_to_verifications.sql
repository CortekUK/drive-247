-- Add customer_email column to identity_verifications for auto-linking
-- This allows matching verifications to customers by email when rental is created

ALTER TABLE identity_verifications
ADD COLUMN IF NOT EXISTS customer_email TEXT;

-- Create index for fast lookups by email + tenant
CREATE INDEX IF NOT EXISTS idx_identity_verifications_customer_email
ON identity_verifications(customer_email, tenant_id)
WHERE customer_email IS NOT NULL AND customer_id IS NULL;

-- Comment
COMMENT ON COLUMN identity_verifications.customer_email IS 'Customer email for auto-linking verifications created during booking flow';
