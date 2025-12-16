-- Remove all transactional data for clean testing (correct order for foreign keys)

-- Delete all payment applications first
DELETE FROM payment_applications;

-- Delete all reminder events and logs
DELETE FROM reminder_events;
DELETE FROM reminder_logs;

-- Delete all ledger entries (references payments)
DELETE FROM ledger_entries;

-- Delete all P&L entries  
DELETE FROM pnl_entries;

-- Delete all fine files (references fines)
DELETE FROM fine_files;

-- Delete all fines
DELETE FROM fines;

-- Delete all rentals
DELETE FROM rentals;

-- Now delete payments (after ledger entries)
DELETE FROM payments;

-- Reset vehicle status to Available
UPDATE vehicles SET status = 'Available';