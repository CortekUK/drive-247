-- Add rental_period_type to rentals table

-- Add rental period type column
ALTER TABLE rentals
ADD COLUMN IF NOT EXISTS rental_period_type TEXT DEFAULT 'Monthly' CHECK (rental_period_type IN ('Daily', 'Weekly', 'Monthly'));

-- Add comment
COMMENT ON COLUMN rentals.rental_period_type IS 'Type of rental period: Daily, Weekly, or Monthly';

-- Update existing rentals to have Monthly as default
UPDATE rentals
SET rental_period_type = 'Monthly'
WHERE rental_period_type IS NULL;
