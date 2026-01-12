-- Cleanup Script for Temporary "Pending Booking" Customers
-- This script deletes ONLY records that match ALL of these criteria:
--   1. name = 'Pending Booking'
--   2. email LIKE 'pending-%@temp.booking'
--   3. phone = '0000000000'
--   4. type = 'Individual'

-- ============================================
-- STEP 1: PREVIEW - See what will be deleted
-- ============================================

-- First, let's see all the temp customers that will be deleted
SELECT
    id,
    name,
    email,
    phone,
    type,
    created_at,
    tenant_id
FROM customers
WHERE
    name = 'Pending Booking'
    AND email LIKE 'pending-%@temp.booking'
    AND phone = '0000000000'
    AND type = 'Individual'
ORDER BY created_at DESC;

-- Count of records to be deleted
SELECT COUNT(*) as total_temp_customers_to_delete
FROM customers
WHERE
    name = 'Pending Booking'
    AND email LIKE 'pending-%@temp.booking'
    AND phone = '0000000000'
    AND type = 'Individual';

-- ============================================
-- STEP 2: Check for related documents
-- ============================================

-- See if any of these temp customers have documents
SELECT
    cd.id as document_id,
    cd.customer_id,
    cd.document_type,
    cd.file_url,
    c.name as customer_name,
    c.email as customer_email
FROM customer_documents cd
JOIN customers c ON cd.customer_id = c.id
WHERE
    c.name = 'Pending Booking'
    AND c.email LIKE 'pending-%@temp.booking'
    AND c.phone = '0000000000'
    AND c.type = 'Individual';

-- ============================================
-- STEP 3: DELETE (run these in order)
-- ============================================

-- First, delete related documents (FK constraint)
DELETE FROM customer_documents
WHERE customer_id IN (
    SELECT id FROM customers
    WHERE
        name = 'Pending Booking'
        AND email LIKE 'pending-%@temp.booking'
        AND phone = '0000000000'
        AND type = 'Individual'
);

-- Then, delete the temp customers
DELETE FROM customers
WHERE
    name = 'Pending Booking'
    AND email LIKE 'pending-%@temp.booking'
    AND phone = '0000000000'
    AND type = 'Individual';

-- ============================================
-- STEP 4: Verify cleanup
-- ============================================

-- Confirm no temp customers remain
SELECT COUNT(*) as remaining_temp_customers
FROM customers
WHERE
    name = 'Pending Booking'
    AND email LIKE 'pending-%@temp.booking'
    AND phone = '0000000000'
    AND type = 'Individual';
