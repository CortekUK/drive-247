-- Add partial unique index to prevent duplicate InitialFee payments per rental
-- This ensures only one InitialFee payment can exist per rental

CREATE UNIQUE INDEX ux_payments_rental_initial_fee 
ON public.payments (rental_id, payment_type) 
WHERE payment_type = 'InitialFee';