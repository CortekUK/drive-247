-- Clear all business data for fresh testing
-- Preserve users, reminder_settings, and database structure

-- Delete in order to respect foreign key constraints
DELETE FROM reminder_logs;
DELETE FROM reminder_events;
DELETE FROM authority_payments;
DELETE FROM fine_files;
DELETE FROM payment_applications;
DELETE FROM ledger_entries;
DELETE FROM pnl_entries;
DELETE FROM payments;
DELETE FROM fines;
DELETE FROM customer_documents;

-- Clear vehicle assignments from plates
UPDATE plates SET assigned_vehicle_id = NULL;
DELETE FROM plates;

DELETE FROM rentals;
DELETE FROM customers;
DELETE FROM vehicles;

-- Clear login attempts for clean slate
DELETE FROM login_attempts;