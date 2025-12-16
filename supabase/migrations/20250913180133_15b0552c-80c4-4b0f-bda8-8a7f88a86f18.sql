-- Remove all transactional data for clean testing

-- Delete all payment applications first (foreign key dependencies)
DELETE FROM payment_applications;

-- Delete all payments
DELETE FROM payments;

-- Delete all ledger entries
DELETE FROM ledger_entries;

-- Delete all P&L entries
DELETE FROM pnl_entries;

-- Delete all rentals
DELETE FROM rentals;

-- Delete all reminder events and logs
DELETE FROM reminder_events;
DELETE FROM reminder_logs;

-- Delete all fines
DELETE FROM fines;

-- Delete all fine files
DELETE FROM fine_files;

-- Reset vehicle status to Available
UPDATE vehicles SET status = 'Available';

-- Keep customers and vehicles for testing
-- Keep plates for testing