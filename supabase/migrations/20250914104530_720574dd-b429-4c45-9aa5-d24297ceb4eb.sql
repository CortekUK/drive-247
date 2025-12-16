-- Clear test data for rental allocation testing (respecting foreign key constraints)
-- This will remove all data to allow fresh testing

-- Clear payment applications first (foreign key dependencies)
DELETE FROM payment_applications;

-- Clear P&L entries
DELETE FROM pnl_entries;

-- Clear reminder events
DELETE FROM reminder_events;

-- Clear reminder logs
DELETE FROM reminder_logs;

-- Clear authority payments
DELETE FROM authority_payments;

-- Clear fines
DELETE FROM fines;

-- Clear ledger entries (these reference payments via payment_id)
DELETE FROM ledger_entries;

-- Clear payments (after ledger entries are cleared)
DELETE FROM payments;

-- Clear rentals
DELETE FROM rentals;

-- Reset vehicle status to Available
UPDATE vehicles SET status = 'Available';

-- Reset customer statuses
UPDATE customers SET status = 'Active';