-- Clean up test data for fresh testing

-- Delete payment applications first (foreign key dependencies)
DELETE FROM payment_applications 
WHERE payment_id IN (
  SELECT id FROM payments 
  WHERE customer_id = '6bc27fd4-89ab-4cd2-a0d8-7dc1d1809995'
);

-- Delete payments for the test customer
DELETE FROM payments 
WHERE customer_id = '6bc27fd4-89ab-4cd2-a0d8-7dc1d1809995';

-- Delete ledger entries for the test customer
DELETE FROM ledger_entries 
WHERE customer_id = '6bc27fd4-89ab-4cd2-a0d8-7dc1d1809995';

-- Delete PnL entries for the test vehicle (except acquisition cost)
DELETE FROM pnl_entries 
WHERE vehicle_id = 'fb34f191-a698-4b26-bf8d-66d19e4c6001' 
  AND category != 'Acquisition';

-- Delete test rentals
DELETE FROM rentals 
WHERE customer_id = '6bc27fd4-89ab-4cd2-a0d8-7dc1d1809995';

-- Reset vehicle status back to Available
UPDATE vehicles 
SET status = 'Available' 
WHERE id = 'fb34f191-a698-4b26-bf8d-66d19e4c6001';