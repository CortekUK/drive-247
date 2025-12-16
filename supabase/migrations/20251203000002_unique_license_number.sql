-- Migration: Add unique constraints on license_number and email to prevent duplicate customers
-- This ensures no two customers can have the same license number or email

-- Handle existing duplicate license numbers
-- Keep the most recently updated one, add suffix to others
UPDATE customers c1
SET license_number = c1.license_number || '_DUP_' || c1.id
WHERE c1.license_number IS NOT NULL
  AND c1.license_number != ''
  AND EXISTS (
    SELECT 1 FROM customers c2
    WHERE c2.license_number = c1.license_number
      AND c2.id != c1.id
      AND c2.updated_at > c1.updated_at
  );

-- Handle existing duplicate emails
-- Keep the most recently updated one, add suffix to others
UPDATE customers c1
SET email = c1.email || '_DUP_' || c1.id
WHERE c1.email IS NOT NULL
  AND c1.email != ''
  AND EXISTS (
    SELECT 1 FROM customers c2
    WHERE c2.email = c1.email
      AND c2.id != c1.id
      AND c2.updated_at > c1.updated_at
  );

-- Now create the unique index for license_number (allowing NULL values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_license_number_unique
ON customers(license_number)
WHERE license_number IS NOT NULL AND license_number != '';

-- Create unique index for email (allowing NULL values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_unique
ON customers(email)
WHERE email IS NOT NULL AND email != '';
