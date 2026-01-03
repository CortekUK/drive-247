-- Update minimum_rental_age constraint to allow ages from 16+
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS minimum_rental_age_check;
ALTER TABLE public.tenants ADD CONSTRAINT minimum_rental_age_check CHECK (minimum_rental_age >= 16);
