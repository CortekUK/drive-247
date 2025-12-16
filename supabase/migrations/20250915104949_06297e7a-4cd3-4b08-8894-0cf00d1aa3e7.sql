-- Run the backfill function to update existing payments with missing rental_ids
SELECT backfill_payment_rental_ids();