-- Clean up all test data for fresh acceptance testing

-- Delete payment applications first (foreign key dependency)
DELETE FROM payment_applications 
WHERE payment_id IN (
  SELECT id FROM payments 
  WHERE customer_id = '8d10730e-8a1f-4b65-aecb-5d9f698eef2a'
);

-- Delete payments
DELETE FROM payments 
WHERE customer_id = '8d10730e-8a1f-4b65-aecb-5d9f698eef2a';

-- Delete ledger entries
DELETE FROM ledger_entries 
WHERE customer_id = '8d10730e-8a1f-4b65-aecb-5d9f698eef2a';

-- Delete P&L entries for the test customer
DELETE FROM pnl_entries 
WHERE customer_id = '8d10730e-8a1f-4b65-aecb-5d9f698eef2a';

-- Delete test rentals  
DELETE FROM rentals 
WHERE customer_id = '8d10730e-8a1f-4b65-aecb-5d9f698eef2a';

-- Also clean up any P&L entries that might reference test data by vehicle
DELETE FROM pnl_entries 
WHERE vehicle_id = '309ea187-8228-4711-949d-5e65ed210bbb' 
  AND category IN ('Initial Fees', 'Rental');

VACUUM ANALYZE payments;
VACUUM ANALYZE ledger_entries;
VACUUM ANALYZE pnl_entries;
VACUUM ANALYZE rentals;