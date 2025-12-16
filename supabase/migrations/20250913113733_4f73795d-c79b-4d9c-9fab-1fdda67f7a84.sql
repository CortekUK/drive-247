-- Clear all demo data from the database
-- Delete in dependency order to avoid constraint violations

-- First, clear all dependent tables
DELETE FROM reminder_logs;
DELETE FROM reminder_events;
DELETE FROM payment_applications;
DELETE FROM fine_files;
DELETE FROM customer_documents;

-- Clear main transaction tables
DELETE FROM pnl_entries;
DELETE FROM ledger_entries;
DELETE FROM payments;
DELETE FROM fines;

-- Clear rental and core entity tables
DELETE FROM rentals;
DELETE FROM plates;
DELETE FROM customers WHERE id != '00000000-0000-0000-0000-000000000000'::uuid; -- Keep any system customers if they exist
DELETE FROM vehicles WHERE id != '00000000-0000-0000-0000-000000000000'::uuid; -- Keep any system vehicles if they exist

-- Clear reminder settings (optional - uncomment if needed)
-- DELETE FROM reminder_settings;

-- Reset any auto-increment sequences if they exist
-- This ensures fresh IDs for new test data