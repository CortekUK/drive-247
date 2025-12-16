-- Clear test data for rental allocation testing
-- This will remove all data to allow fresh testing

-- Clear payment applications first (foreign key dependencies)
DELETE FROM payment_applications;

-- Clear payments
DELETE FROM payments;

-- Clear ledger entries
DELETE FROM ledger_entries;

-- Clear authority payments
DELETE FROM authority_payments;

-- Clear fines
DELETE FROM fines;

-- Clear rentals
DELETE FROM rentals;

-- Clear reminder events
DELETE FROM reminder_events;

-- Clear reminder logs
DELETE FROM reminder_logs;

-- Clear P&L entries
DELETE FROM pnl_entries;

-- Reset vehicle status to Available
UPDATE vehicles SET status = 'Available';

-- Reset customer statuses
UPDATE customers SET status = 'Active';