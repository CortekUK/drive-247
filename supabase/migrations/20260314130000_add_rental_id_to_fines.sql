-- Add rental_id column to fines table
ALTER TABLE fines ADD COLUMN rental_id UUID REFERENCES rentals(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX idx_fines_rental_id ON fines(rental_id);
