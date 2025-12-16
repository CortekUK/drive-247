-- Add weekly_rent and monthly_rent columns to vehicles table
-- Also ensure daily_rent column exists (rename from rent_per_day if needed)

-- Check if rent_per_day exists and rename it to daily_rent
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'vehicles'
        AND column_name = 'rent_per_day'
    ) THEN
        ALTER TABLE vehicles RENAME COLUMN rent_per_day TO daily_rent;
    END IF;
END $$;

-- Add daily_rent column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'vehicles'
        AND column_name = 'daily_rent'
    ) THEN
        ALTER TABLE vehicles ADD COLUMN daily_rent numeric(10,2);
        COMMENT ON COLUMN vehicles.daily_rent IS 'Daily rental rate for the vehicle';
    END IF;
END $$;

-- Add weekly_rent column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'vehicles'
        AND column_name = 'weekly_rent'
    ) THEN
        ALTER TABLE vehicles ADD COLUMN weekly_rent numeric(10,2);
        COMMENT ON COLUMN vehicles.weekly_rent IS 'Weekly rental rate for the vehicle';
    END IF;
END $$;

-- Add monthly_rent column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'vehicles'
        AND column_name = 'monthly_rent'
    ) THEN
        ALTER TABLE vehicles ADD COLUMN monthly_rent numeric(10,2);
        COMMENT ON COLUMN vehicles.monthly_rent IS 'Monthly rental rate for the vehicle';
    END IF;
END $$;
