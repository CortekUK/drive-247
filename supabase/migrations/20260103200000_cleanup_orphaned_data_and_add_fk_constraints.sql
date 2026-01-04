-- Migration: Clean up orphaned data and add proper foreign key constraints
-- This fixes 400 errors caused by rentals/payments/fines referencing non-existent customers or vehicles
-- Made idempotent to handle partial application

-- =====================================================
-- STEP 1: Create audit table (if not exists)
-- =====================================================

CREATE TABLE IF NOT EXISTS _orphaned_data_audit (
    id SERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    orphan_type TEXT NOT NULL,
    cleaned_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- STEP 2: Clean up orphaned ledger_entries FIRST (they reference payments)
-- =====================================================

-- Delete ledger_entries with missing customers
DELETE FROM ledger_entries
WHERE customer_id IS NOT NULL
AND customer_id NOT IN (SELECT id FROM customers);

-- Delete ledger_entries with missing rentals
DELETE FROM ledger_entries
WHERE rental_id IS NOT NULL
AND rental_id NOT IN (SELECT id FROM rentals);

-- Delete ledger_entries with missing payments (this is key!)
DELETE FROM ledger_entries
WHERE payment_id IS NOT NULL
AND payment_id NOT IN (SELECT id FROM payments WHERE customer_id IN (SELECT id FROM customers));

-- =====================================================
-- STEP 3: Clean up payment_applications (they reference payments)
-- =====================================================

DELETE FROM payment_applications
WHERE payment_id NOT IN (SELECT id FROM payments WHERE customer_id IN (SELECT id FROM customers));

-- =====================================================
-- STEP 4: Clean up orphaned payments
-- =====================================================

-- Log orphaned payments
INSERT INTO _orphaned_data_audit (table_name, record_id, orphan_type)
SELECT 'payments', p.id, 'missing_customer'
FROM payments p
WHERE p.customer_id IS NOT NULL
AND p.customer_id NOT IN (SELECT id FROM customers)
AND p.id NOT IN (SELECT record_id FROM _orphaned_data_audit WHERE table_name = 'payments');

-- Now delete payments with missing customers
DELETE FROM payments
WHERE customer_id IS NOT NULL
AND customer_id NOT IN (SELECT id FROM customers);

-- Set vehicle_id to NULL for payments with missing vehicles
UPDATE payments
SET vehicle_id = NULL
WHERE vehicle_id IS NOT NULL
AND vehicle_id NOT IN (SELECT id FROM vehicles);

-- =====================================================
-- STEP 5: Clean up orphaned rentals
-- =====================================================

-- First clean up dependent records
DELETE FROM ledger_entries WHERE rental_id IN (
    SELECT id FROM rentals WHERE customer_id NOT IN (SELECT id FROM customers)
);

DELETE FROM payments WHERE rental_id IN (
    SELECT id FROM rentals WHERE customer_id NOT IN (SELECT id FROM customers)
);

-- Log orphaned rentals
INSERT INTO _orphaned_data_audit (table_name, record_id, orphan_type)
SELECT 'rentals', r.id, 'missing_customer'
FROM rentals r
WHERE r.customer_id IS NOT NULL
AND r.customer_id NOT IN (SELECT id FROM customers)
AND r.id NOT IN (SELECT record_id FROM _orphaned_data_audit WHERE table_name = 'rentals');

-- Delete rentals with missing customers
DELETE FROM rentals
WHERE customer_id IS NOT NULL
AND customer_id NOT IN (SELECT id FROM customers);

-- Set vehicle_id to NULL for rentals with missing vehicles
UPDATE rentals
SET vehicle_id = NULL
WHERE vehicle_id IS NOT NULL
AND vehicle_id NOT IN (SELECT id FROM vehicles);

-- =====================================================
-- STEP 6: Clean up orphaned fines
-- =====================================================

DELETE FROM fines
WHERE customer_id IS NOT NULL
AND customer_id NOT IN (SELECT id FROM customers);

UPDATE fines
SET vehicle_id = NULL
WHERE vehicle_id IS NOT NULL
AND vehicle_id NOT IN (SELECT id FROM vehicles);

-- =====================================================
-- STEP 7: Clean up orphaned pnl_entries
-- =====================================================

DELETE FROM pnl_entries
WHERE vehicle_id IS NOT NULL
AND vehicle_id NOT IN (SELECT id FROM vehicles);

-- =====================================================
-- STEP 8: Clean up orphaned insurance_policies
-- =====================================================

DELETE FROM insurance_policies
WHERE customer_id IS NOT NULL
AND customer_id NOT IN (SELECT id FROM customers);

-- =====================================================
-- STEP 9: Update foreign key constraints
-- =====================================================

-- Rentals FK constraints
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_customer_id_fkey;
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_vehicle_id_fkey;

ALTER TABLE rentals
ADD CONSTRAINT rentals_customer_id_fkey
FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

ALTER TABLE rentals
ADD CONSTRAINT rentals_vehicle_id_fkey
FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;

-- Payments FK constraints
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_customer_id_fkey;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_vehicle_id_fkey;

ALTER TABLE payments
ADD CONSTRAINT payments_customer_id_fkey
FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

ALTER TABLE payments
ADD CONSTRAINT payments_vehicle_id_fkey
FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;

-- Fines FK constraints
ALTER TABLE fines DROP CONSTRAINT IF EXISTS fines_customer_id_fkey;
ALTER TABLE fines DROP CONSTRAINT IF EXISTS fines_vehicle_id_fkey;

ALTER TABLE fines
ADD CONSTRAINT fines_customer_id_fkey
FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

ALTER TABLE fines
ADD CONSTRAINT fines_vehicle_id_fkey
FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;

-- Ledger entries FK constraints
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
-- STEP 10: Summary
-- =====================================================

COMMENT ON TABLE _orphaned_data_audit IS 'Audit log of orphaned data cleaned up. Can be dropped after verification.';
