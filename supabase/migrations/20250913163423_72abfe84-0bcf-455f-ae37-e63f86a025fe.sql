-- Clear all data from the database for fresh testing
-- Delete in order to respect foreign key constraints

-- Clear application data first
DELETE FROM payment_applications;
DELETE FROM pnl_entries;
DELETE FROM reminder_events;
DELETE FROM reminder_logs;
DELETE FROM ledger_entries;

-- Clear main entity data
DELETE FROM payments;
DELETE FROM fine_files;
DELETE FROM fines;
DELETE FROM customer_documents;
DELETE FROM rentals;
DELETE FROM plates;

-- Clear master data
DELETE FROM vehicles;
DELETE FROM customers;

-- Clear system data
DELETE FROM reminder_settings;
DELETE FROM login_attempts;
DELETE FROM users;