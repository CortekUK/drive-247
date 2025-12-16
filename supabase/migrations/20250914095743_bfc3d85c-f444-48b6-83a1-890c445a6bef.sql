-- First, temporarily remove the check constraint
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_type_check;

-- Update existing customer payments to use generic 'Payment' type
UPDATE payments 
SET payment_type = 'Payment' 
WHERE payment_type IN ('Rental', 'Fine', 'Other');

-- Add new check constraint that allows 'Payment' and 'InitialFee'
ALTER TABLE payments ADD CONSTRAINT payments_payment_type_check 
CHECK (payment_type IN ('Payment', 'InitialFee'));

-- Set default for new payments
ALTER TABLE payments ALTER COLUMN payment_type SET DEFAULT 'Payment';

-- Add comment to clarify the new approach
COMMENT ON COLUMN payments.payment_type IS 'Customer payments use generic "Payment" type. System uses "InitialFee" for auto-generated initial fees.';