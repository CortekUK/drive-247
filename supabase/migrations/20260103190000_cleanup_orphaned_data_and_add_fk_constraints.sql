-- Migration: Clean up orphaned data and add proper foreign key constraints
-- This fixes 400 errors caused by rentals/payments/fines referencing non-existent customers or vehicles

-- =====================================================
-- STEP 1: Identify and log orphaned records (for audit)
-- =====================================================

-- Create a temporary audit table to track what we're cleaning up
CREATE TABLE IF NOT EXISTS _orphaned_data_audit (
    id SERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    orphan_type TEXT NOT NULL, -- 'missing_customer', 'missing_vehicle', etc.
    cleaned_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- STEP 2: Clean up orphaned rentals
-- =====================================================

-- Log orphaned rentals with missing customers
INSERT INTO _orphaned_data_audit (table_name, record_id, orphan_type)
SELECT 'rentals', r.id, 'missing_customer'
FROM rentals r
LEFT JOIN customers c ON r.customer_id = c.id
WHERE r.customer_id IS NOT NULL AND c.id IS NULL;

-- Log orphaned rentals with missing vehicles
INSERT INTO _orphaned_data_audit (table_name, record_id, orphan_type)
SELECT 'rentals', r.id, 'missing_vehicle'
FROM rentals r
LEFT JOIN vehicles v ON r.vehicle_id = v.id
WHERE r.vehicle_id IS NOT NULL AND v.id IS NULL;

-- Delete rentals with missing customers (can't have a rental without a customer)
DELETE FROM rentals
WHERE customer_id IS NOT NULL
AND customer_id NOT IN (SELECT id FROM customers);

-- Set vehicle_id to NULL for rentals with missing vehicles (rental can exist without vehicle reference)
UPDATE rentals
SET vehicle_id = NULL
WHERE vehicle_id IS NOT NULL
AND vehicle_id NOT IN (SELECT id FROM vehicles);

-- =====================================================
-- STEP 3: Clean up orphaned payments
-- =====================================================

-- Log orphaned payments with missing customers
INSERT INTO _orphaned_data_audit (table_name, record_id, orphan_type)
SELECT 'payments', p.id, 'missing_customer'
FROM payments p
LEFT JOIN customers c ON p.customer_id = c.id
WHERE p.customer_id IS NOT NULL AND c.id IS NULL;

-- Log orphaned payments with missing vehicles
INSERT INTO _orphaned_data_audit (table_name, record_id, orphan_type)
SELECT 'payments', p.id, 'missing_vehicle'
FROM payments p
LEFT JOIN vehicles v ON p.vehicle_id = v.id
WHERE p.vehicle_id IS NOT NULL AND v.id IS NULL;

-- Delete payments with missing customers
DELETE FROM payments
WHERE customer_id IS NOT NULL
AND customer_id NOT IN (SELECT id FROM customers);

-- Set vehicle_id to NULL for payments with missing vehicles
UPDATE payments
SET vehicle_id = NULL
WHERE vehicle_id IS NOT NULL
AND vehicle_id NOT IN (SELECT id FROM vehicles);

-- =====================================================
-- STEP 4: Clean up orphaned fines
-- =====================================================

-- Log orphaned fines
INSERT INTO _orphaned_data_audit (table_name, record_id, orphan_type)
SELECT 'fines', f.id, 'missing_customer'
FROM fines f
LEFT JOIN customers c ON f.customer_id = c.id
WHERE f.customer_id IS NOT NULL AND c.id IS NULL;

INSERT INTO _orphaned_data_audit (table_name, record_id, orphan_type)
SELECT 'fines', f.id, 'missing_vehicle'
FROM fines f
LEFT JOIN vehicles v ON f.vehicle_id = v.id
WHERE f.vehicle_id IS NOT NULL AND v.id IS NULL;

-- Delete fines with missing customers
DELETE FROM fines
WHERE customer_id IS NOT NULL
AND customer_id NOT IN (SELECT id FROM customers);

-- Set vehicle_id to NULL for fines with missing vehicles
UPDATE fines
SET vehicle_id = NULL
WHERE vehicle_id IS NOT NULL
AND vehicle_id NOT IN (SELECT id FROM vehicles);

-- =====================================================
-- STEP 5: Clean up orphaned ledger_entries
-- =====================================================

INSERT INTO _orphaned_data_audit (table_name, record_id, orphan_type)
SELECT 'ledger_entries', le.id, 'missing_customer'
FROM ledger_entries le
LEFT JOIN customers c ON le.customer_id = c.id
WHERE le.customer_id IS NOT NULL AND c.id IS NULL;

INSERT INTO _orphaned_data_audit (table_name, record_id, orphan_type)
SELECT 'ledger_entries', le.id, 'missing_rental'
FROM ledger_entries le
LEFT JOIN rentals r ON le.rental_id = r.id
WHERE le.rental_id IS NOT NULL AND r.id IS NULL;

-- Delete ledger entries with missing customers
DELETE FROM ledger_entries
WHERE customer_id IS NOT NULL
AND customer_id NOT IN (SELECT id FROM customers);

-- Delete ledger entries with missing rentals
DELETE FROM ledger_entries
WHERE rental_id IS NOT NULL
AND rental_id NOT IN (SELECT id FROM rentals);

-- =====================================================
-- STEP 6: Clean up orphaned pnl_entries
-- =====================================================

INSERT INTO _orphaned_data_audit (table_name, record_id, orphan_type)
SELECT 'pnl_entries', pe.id, 'missing_vehicle'
FROM pnl_entries pe
LEFT JOIN vehicles v ON pe.vehicle_id = v.id
WHERE pe.vehicle_id IS NOT NULL AND v.id IS NULL;

-- Delete pnl entries with missing vehicles
DELETE FROM pnl_entries
WHERE vehicle_id IS NOT NULL
AND vehicle_id NOT IN (SELECT id FROM vehicles);

-- =====================================================
-- STEP 7: Clean up orphaned insurance_policies
-- =====================================================

INSERT INTO _orphaned_data_audit (table_name, record_id, orphan_type)
SELECT 'insurance_policies', ip.id, 'missing_customer'
FROM insurance_policies ip
LEFT JOIN customers c ON ip.customer_id = c.id
WHERE ip.customer_id IS NOT NULL AND c.id IS NULL;

DELETE FROM insurance_policies
WHERE customer_id IS NOT NULL
AND customer_id NOT IN (SELECT id FROM customers);

-- =====================================================
-- STEP 8: Update foreign key constraints with ON DELETE behavior
-- =====================================================

-- Drop and recreate rentals FK constraints with proper ON DELETE behavior
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_customer_id_fkey;
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_vehicle_id_fkey;

ALTER TABLE rentals
ADD CONSTRAINT rentals_customer_id_fkey
FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

ALTER TABLE rentals
ADD CONSTRAINT rentals_vehicle_id_fkey
FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;

-- Drop and recreate payments FK constraints
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_customer_id_fkey;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_vehicle_id_fkey;

ALTER TABLE payments
ADD CONSTRAINT payments_customer_id_fkey
FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

ALTER TABLE payments
ADD CONSTRAINT payments_vehicle_id_fkey
FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;

-- Drop and recreate fines FK constraints
ALTER TABLE fines DROP CONSTRAINT IF EXISTS fines_customer_id_fkey;
ALTER TABLE fines DROP CONSTRAINT IF EXISTS fines_vehicle_id_fkey;

ALTER TABLE fines
ADD CONSTRAINT fines_customer_id_fkey
FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

ALTER TABLE fines
ADD CONSTRAINT fines_vehicle_id_fkey
FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;

-- Drop and recreate ledger_entries FK constraints
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_customer_id_fkey;
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_rental_id_fkey;
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_vehicle_id_fkey;

ALTER TABLE ledger_entries
ADD CONSTRAINT ledger_entries_customer_id_fkey
FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

ALTER TABLE ledger_entries
ADD CONSTRAINT ledger_entries_rental_id_fkey
FOREIGN KEY (rental_id) REFERENCES rentals(id) ON DELETE CASCADE;

ALTER TABLE ledger_entries
ADD CONSTRAINT ledger_entries_vehicle_id_fkey
FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;

-- =====================================================
-- STEP 9: Add NOT NULL constraint to critical columns (after cleanup)
-- =====================================================

-- Ensure rentals always have a customer
ALTER TABLE rentals ALTER COLUMN customer_id SET NOT NULL;

-- =====================================================
-- STEP 10: Log summary
-- =====================================================

DO $$
DECLARE
    orphan_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO orphan_count FROM _orphaned_data_audit;
    RAISE NOTICE 'Orphaned data cleanup complete. Total orphaned records found and cleaned: %', orphan_count;
END $$;

-- Add comment for reference
COMMENT ON TABLE _orphaned_data_audit IS 'Audit log of orphaned data cleaned up on 2026-01-03. Can be dropped after verification.';
