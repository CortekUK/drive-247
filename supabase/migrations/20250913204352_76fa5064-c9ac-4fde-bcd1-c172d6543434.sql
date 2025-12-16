-- Clear all test data for fresh testing
-- Delete in correct order to avoid foreign key constraint issues

DELETE FROM payment_applications;
DELETE FROM reminder_events; 
DELETE FROM reminder_logs;
DELETE FROM ledger_entries;
DELETE FROM pnl_entries;
DELETE FROM payments;
DELETE FROM customer_documents;
DELETE FROM fine_files;
DELETE FROM fines;
DELETE FROM rentals;
DELETE FROM plates WHERE assigned_vehicle_id IS NOT NULL;
DELETE FROM customers;
DELETE FROM vehicles;

-- Keep only unassigned plates if any exist
-- DELETE FROM plates; -- Uncomment if you want to remove all plates too