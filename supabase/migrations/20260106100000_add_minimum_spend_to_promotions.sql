-- Add minimum_spend column to promotions table
-- This allows admins to set a minimum spend threshold for fixed discounts

ALTER TABLE promotions
ADD COLUMN IF NOT EXISTS minimum_spend DECIMAL(10, 2) DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN promotions.minimum_spend IS 'Minimum spend amount required for the discount to apply. Only relevant for fixed discounts.';
