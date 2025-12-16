-- Clear all data for fresh testing
TRUNCATE TABLE payment_applications CASCADE;
TRUNCATE TABLE pnl_entries CASCADE;
TRUNCATE TABLE ledger_entries CASCADE;
TRUNCATE TABLE payments CASCADE;
TRUNCATE TABLE authority_payments CASCADE;
TRUNCATE TABLE fine_files CASCADE;
TRUNCATE TABLE fines CASCADE;
TRUNCATE TABLE customer_documents CASCADE;
TRUNCATE TABLE rentals CASCADE;
TRUNCATE TABLE plates CASCADE;
TRUNCATE TABLE customers CASCADE;
TRUNCATE TABLE vehicles CASCADE;
TRUNCATE TABLE reminder_events CASCADE;
TRUNCATE TABLE reminder_logs CASCADE;
TRUNCATE TABLE reminder_settings CASCADE;

-- Reset sequences for auto-incrementing fields if any exist
-- (Most tables use UUIDs so this may not be necessary, but included for completeness)