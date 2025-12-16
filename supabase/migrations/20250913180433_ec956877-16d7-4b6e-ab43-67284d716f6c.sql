-- Remove ALL data from the database for complete reset

-- Delete all transactional data first (already done but ensuring completeness)
DELETE FROM payment_applications;
DELETE FROM reminder_events;
DELETE FROM reminder_logs;
DELETE FROM ledger_entries;
DELETE FROM pnl_entries;
DELETE FROM fine_files;
DELETE FROM fines;
DELETE FROM rentals;
DELETE FROM payments;

-- Delete customer-related data
DELETE FROM customer_documents;
DELETE FROM customers;

-- Delete vehicle-related data
DELETE FROM plates;
DELETE FROM vehicles;

-- Delete user-related data (keep system admin if exists)
DELETE FROM login_attempts;
DELETE FROM users WHERE username != 'admin';

-- Delete reminder settings
DELETE FROM reminder_settings;

-- Reset any sequences/counters if needed
-- This ensures clean slate for testing