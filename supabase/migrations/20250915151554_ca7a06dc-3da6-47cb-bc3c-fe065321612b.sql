-- Create ledger entry for the missing £1500 payment
-- Use NULL rental_id since this payment spans multiple rentals/charges
-- This avoids the unique constraint issue while still tracking the payment

INSERT INTO ledger_entries (
  customer_id, 
  rental_id, 
  vehicle_id, 
  entry_date, 
  type, 
  category, 
  amount, 
  due_date, 
  remaining_amount, 
  payment_id
)
VALUES (
  '557c1439-89b0-4d26-aeca-a682bd5ebe2c',  -- customer_id
  NULL,  -- rental_id set to NULL since it spans multiple rentals
  '47f12509-4af4-4433-9c1f-038cca0f3a25',  -- vehicle_id
  '2025-09-15',  -- entry_date (when payment was made)
  'Payment',
  'Rental', 
  -1500.00,  -- negative amount for payment
  '2025-09-15',  -- due_date (payment due date, same as entry date)
  0,  -- remaining_amount is 0 for payments
  '963c0187-912c-4aa4-9d0f-60063c2a8395'  -- payment_id
)
ON CONFLICT DO NOTHING;