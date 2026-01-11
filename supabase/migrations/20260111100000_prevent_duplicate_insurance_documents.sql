-- Migration: Prevent duplicate insurance documents
-- This cleans up existing duplicates and adds unique constraints to prevent
-- the same insurance document being uploaded twice for the same rental or customer

-- Step 1: Remove duplicate insurance documents for rentals (keep the oldest one)
-- This uses a CTE to identify duplicates and delete all but the first (oldest) one
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, rental_id, document_type, file_name
      ORDER BY uploaded_at ASC, created_at ASC, id ASC
    ) as rn
  FROM customer_documents
  WHERE rental_id IS NOT NULL
    AND document_type = 'Insurance Certificate'
)
DELETE FROM customer_documents
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Step 2: Remove duplicate insurance documents for customers without rental link
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, customer_id, document_type, file_name
      ORDER BY uploaded_at ASC, created_at ASC, id ASC
    ) as rn
  FROM customer_documents
  WHERE rental_id IS NULL
    AND document_type = 'Insurance Certificate'
)
DELETE FROM customer_documents
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Step 3: Add unique partial index for documents linked to a rental
-- This prevents duplicate insurance certificates for the same rental
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_documents_unique_rental_insurance
ON customer_documents (tenant_id, rental_id, document_type, file_name)
WHERE rental_id IS NOT NULL AND document_type = 'Insurance Certificate';

-- Step 4: Add unique partial index for documents not yet linked to a rental
-- This prevents duplicate uploads during the booking flow before rental is created
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_documents_unique_customer_insurance
ON customer_documents (tenant_id, customer_id, document_type, file_name)
WHERE rental_id IS NULL AND document_type = 'Insurance Certificate';

-- Add comments explaining the constraints
COMMENT ON INDEX idx_customer_documents_unique_rental_insurance IS
'Prevents duplicate Insurance Certificate documents for the same rental. Part of double-upload prevention.';

COMMENT ON INDEX idx_customer_documents_unique_customer_insurance IS
'Prevents duplicate Insurance Certificate documents during booking flow before rental linking. Part of double-upload prevention.';
