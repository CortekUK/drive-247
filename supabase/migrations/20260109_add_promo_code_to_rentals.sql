
ALTER TABLE rentals 
ADD COLUMN IF NOT EXISTS promo_code text,
ADD COLUMN IF NOT EXISTS discount_applied numeric;
