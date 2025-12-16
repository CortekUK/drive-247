-- Clear all operational data for testing
-- Delete in order to respect foreign key constraints

-- Clear dependent tables first
DELETE FROM payment_applications;
DELETE FROM authority_payments;
DELETE FROM fine_files;
DELETE FROM customer_documents;
DELETE FROM reminder_events;
DELETE FROM reminder_logs;
DELETE FROM ledger_entries;
DELETE FROM pnl_entries;

-- Clear main operational tables
DELETE FROM payments;
DELETE FROM fines;
DELETE FROM rentals;
DELETE FROM plates;

-- Clear customer and vehicle data
DELETE FROM customers;
DELETE FROM vehicles;

-- Clear system/admin tables
DELETE FROM reminder_settings;
DELETE FROM login_attempts;

-- Note: Keeping users table intact for login functionality