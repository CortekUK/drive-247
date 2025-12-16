-- Remove all data from the system (vehicles, customers, payments, etc.)
-- Delete in proper order to respect foreign key constraints

-- Clear all dependent data first
DELETE FROM payment_applications;
DELETE FROM pnl_entries;
DELETE FROM reminder_events;
DELETE FROM reminder_logs;
DELETE FROM authority_payments;
DELETE FROM fine_files;
DELETE FROM fines;
DELETE FROM ledger_entries;
DELETE FROM payments;
DELETE FROM rentals;
DELETE FROM customer_documents;
DELETE FROM plates;

-- Clear main entity tables
DELETE FROM customers;
DELETE FROM vehicles;

-- Clear any remaining reference data
DELETE FROM reminder_settings;