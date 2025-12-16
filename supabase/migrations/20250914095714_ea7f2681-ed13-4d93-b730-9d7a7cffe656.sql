-- Make payment_type nullable and set default for new customer payments
ALTER TABLE payments ALTER COLUMN payment_type DROP DEFAULT;
ALTER TABLE payments ALTER COLUMN payment_type SET DEFAULT 'Payment';

-- Update existing customer payments to use generic 'Payment' type
-- (keeping 'InitialFee' for system-generated initial fees)
UPDATE payments 
SET payment_type = 'Payment' 
WHERE payment_type IN ('Rental', 'Fine', 'Other');

-- Add comment to clarify the new approach
COMMENT ON COLUMN payments.payment_type IS 'Customer payments use generic "Payment" type. System uses "InitialFee" for auto-generated initial fees.';