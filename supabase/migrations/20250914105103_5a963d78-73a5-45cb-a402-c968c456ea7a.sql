-- Clean up the specific test data that's causing the unique constraint violation
DELETE FROM payment_applications WHERE payment_id IN (
  SELECT id FROM payments WHERE customer_id = 'd8671806-e8c9-4a25-b072-9490c50e9616'
);

DELETE FROM payments WHERE customer_id = 'd8671806-e8c9-4a25-b072-9490c50e9616';

DELETE FROM ledger_entries WHERE customer_id = 'd8671806-e8c9-4a25-b072-9490c50e9616';

DELETE FROM rentals WHERE customer_id = 'd8671806-e8c9-4a25-b072-9490c50e9616';