-- Create ledger entry for the missing £1500 payment
-- Use entry_date instead of due_date to avoid unique constraint conflict
-- Since this payment was applied to future charges, it shouldn't conflict with rental due dates

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
  '9fe3f89a-a99b-449e-97b3-2b7ad8eb747d',  -- rental_id  
  '47f12509-4af4-4433-9c1f-038cca0f3a25',  -- vehicle_id
  '2025-09-15',  -- entry_date (when payment was made)
  'Payment',
  'Rental', 
  -1500.00,  -- negative amount for payment
  '2025-09-15',  -- due_date (payment due date, same as entry date)
  0,  -- remaining_amount is 0 for payments
  '963c0187-912c-4aa4-9d0f-60063c2a8395'  -- payment_id
)
ON CONFLICT DO NOTHING;  -- In case it somehow gets created elsewhere