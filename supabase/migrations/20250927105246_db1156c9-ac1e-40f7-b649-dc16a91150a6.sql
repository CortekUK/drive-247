-- Clean up all test data in correct order to handle foreign key constraints

-- Delete payment applications first
DELETE FROM payment_applications;

-- Delete reminder related data
DELETE FROM reminder_events;
DELETE FROM reminder_logs;
DELETE FROM reminder_actions;

-- Delete financial entries
DELETE FROM ledger_entries;
DELETE FROM pnl_entries;

-- Delete payments
DELETE FROM payments;

-- Delete authority payments and fines
DELETE FROM authority_payments;
DELETE FROM fines;

-- Delete vehicle related data
DELETE FROM vehicle_events;
DELETE FROM vehicle_expenses;
DELETE FROM vehicle_files;
DELETE FROM service_records;

-- Delete insurance related data
DELETE FROM insurance_documents;
DELETE FROM insurance_policies;

-- Delete customer documents
DELETE FROM customer_documents;

-- Delete plates
DELETE FROM plates;

-- Delete rentals
DELETE FROM rentals;

-- Delete vehicles and customers last
DELETE FROM vehicles;
DELETE FROM customers;

-- Reset any sequences or counters if needed
-- Note: UUIDs don't use sequences, so no need to reset those