-- Clear all application data for testing
-- Delete in order to respect foreign key constraints

-- Clear payment applications first
DELETE FROM payment_applications;

-- Clear ledger entries
DELETE FROM ledger_entries;

-- Clear P&L entries
DELETE FROM pnl_entries;

-- Clear reminder events and logs
DELETE FROM reminder_events;
DELETE FROM reminder_logs;

-- Clear payments
DELETE FROM payments;

-- Clear fine files
DELETE FROM fine_files;

-- Clear fines
DELETE FROM fines;

-- Clear customer documents
DELETE FROM customer_documents;

-- Clear rentals
DELETE FROM rentals;

-- Clear plates
DELETE FROM plates;

-- Clear customers
DELETE FROM customers;

-- Clear vehicles
DELETE FROM vehicles;

-- Reset reminder settings (optional)
DELETE FROM reminder_settings;