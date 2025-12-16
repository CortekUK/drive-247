-- Drop the existing check constraint on payment_type
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_type_check;

-- Add new check constraint that allows 'Payment' and 'InitialFee'
ALTER TABLE payments ADD CONSTRAINT payments_payment_type_check 
CHECK (payment_type IN ('Payment', 'InitialFee'));

-- Update existing customer payments to use generic 'Payment' type
UPDATE payments 
SET payment_type = 'Payment' 
WHERE payment_type IN ('Rental', 'Fine', 'Other');

-- Set default for new payments
ALTER TABLE payments ALTER COLUMN payment_type SET DEFAULT 'Payment';