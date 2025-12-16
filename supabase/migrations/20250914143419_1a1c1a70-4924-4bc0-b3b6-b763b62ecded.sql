-- Add rental_number column for human-friendly rental identifiers
ALTER TABLE public.rentals 
ADD COLUMN IF NOT EXISTS rental_number TEXT UNIQUE;

-- Backfill existing rentals with R-{6-char-short-id} format
UPDATE public.rentals 
SET rental_number = 'R-' || SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 6)
WHERE rental_number IS NULL;

-- Create index for efficient searching
CREATE INDEX IF NOT EXISTS idx_rentals_rental_number ON public.rentals(rental_number);

-- Add trigger to auto-generate rental_number for new rentals
CREATE OR REPLACE FUNCTION generate_rental_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.rental_number IS NULL THEN
    NEW.rental_number := 'R-' || SUBSTRING(REPLACE(NEW.id::text, '-', '') FROM 1 FOR 6);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for new rentals
DROP TRIGGER IF EXISTS trigger_generate_rental_number ON public.rentals;
CREATE TRIGGER trigger_generate_rental_number
  BEFORE INSERT ON public.rentals
  FOR EACH ROW
  EXECUTE FUNCTION generate_rental_number();