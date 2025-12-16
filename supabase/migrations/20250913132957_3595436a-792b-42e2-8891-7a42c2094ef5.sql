-- Complete data cleanup for fresh start

-- Delete in order to respect foreign key constraints

-- 1. Delete payment applications first
DELETE FROM payment_applications;

-- 2. Delete reminder events and logs
DELETE FROM reminder_events;
DELETE FROM reminder_logs;

-- 3. Delete file attachments
DELETE FROM fine_files;
DELETE FROM customer_documents;

-- 4. Delete P&L entries (business data)
DELETE FROM pnl_entries;

-- 5. Delete payments
DELETE FROM payments;

-- 6. Delete ledger entries
DELETE FROM ledger_entries;

-- 7. Delete fines
DELETE FROM fines;

-- 8. Delete rentals
DELETE FROM rentals;

-- 9. Delete plates
DELETE FROM plates;

-- 10. Delete customers
DELETE FROM customers;

-- 11. Delete vehicles
DELETE FROM vehicles;

-- Keep system tables: users, reminder_settings, login_attempts
-- These contain system configuration and user accounts