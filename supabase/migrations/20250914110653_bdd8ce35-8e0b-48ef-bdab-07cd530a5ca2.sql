-- Add unique constraint to prevent duplicate InitialFee payments per rental
-- This ensures only one InitialFee payment can exist per rental

ALTER TABLE public.payments 
ADD CONSTRAINT ux_payments_rental_initial_fee 
UNIQUE (rental_id, payment_type) 
DEFERRABLE INITIALLY DEFERRED
WHERE payment_type = 'InitialFee';