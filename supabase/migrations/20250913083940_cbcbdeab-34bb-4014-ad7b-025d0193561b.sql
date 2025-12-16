-- Clear all demo data from the database
-- Delete in order to respect foreign key constraints

-- Clear reminder events and logs
DELETE FROM reminder_events;
DELETE FROM reminder_logs;

-- Clear payment applications first
DELETE FROM payment_applications;

-- Clear payments
DELETE FROM payments;

-- Clear ledger entries
DELETE FROM ledger_entries;

-- Clear P&L entries
DELETE FROM pnl_entries;

-- Clear fine files
DELETE FROM fine_files;

-- Clear fines
DELETE FROM fines;

-- Clear customer documents
DELETE FROM customer_documents;

-- Clear rentals
DELETE FROM rentals;

-- Clear plates (unassign from vehicles first)
UPDATE plates SET assigned_vehicle_id = NULL;
DELETE FROM plates;

-- Clear vehicles
DELETE FROM vehicles;

-- Clear customers
DELETE FROM customers;

-- Reset any settings to defaults (keeping the structure)
DELETE FROM reminder_settings WHERE setting_key NOT IN ('company_profile', 'reminder_types');

-- Reset login attempts
DELETE FROM login_attempts;