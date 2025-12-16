-- Clear all demo data while preserving database structure
-- Delete in order to respect foreign key constraints

-- Clear reminder and event data
DELETE FROM reminder_logs;
DELETE FROM reminder_events;

-- Clear P&L entries
DELETE FROM pnl_entries;

-- Clear payment applications and payments
DELETE FROM payment_applications;
DELETE FROM payments;

-- Clear ledger entries
DELETE FROM ledger_entries;

-- Clear fine files and fines
DELETE FROM fine_files;
DELETE FROM fines;

-- Clear customer documents
DELETE FROM customer_documents;

-- Clear plates
DELETE FROM plates;

-- Clear rentals
DELETE FROM rentals;

-- Clear customers and vehicles
DELETE FROM customers;
DELETE FROM vehicles;

-- Clear users (if any demo users exist)
DELETE FROM users;

-- Reset reminder settings to default
DELETE FROM reminder_settings;

-- Reset any sequences/counters if needed
-- (Postgres will automatically handle UUID generation)

-- Verify all tables are empty
DO $$
DECLARE
    table_name text;
    row_count integer;
BEGIN
    FOR table_name IN 
        SELECT t.table_name 
        FROM information_schema.tables t 
        WHERE t.table_schema = 'public' 
        AND t.table_type = 'BASE TABLE'
        AND t.table_name NOT LIKE 'view_%'
        AND t.table_name NOT LIKE 'v_%'
    LOOP
        EXECUTE format('SELECT COUNT(*) FROM %I', table_name) INTO row_count;
        IF row_count > 0 THEN
            RAISE NOTICE 'Table % still has % rows', table_name, row_count;
        ELSE
            RAISE NOTICE 'Table % is now empty', table_name;
        END IF;
    END LOOP;
END $$;