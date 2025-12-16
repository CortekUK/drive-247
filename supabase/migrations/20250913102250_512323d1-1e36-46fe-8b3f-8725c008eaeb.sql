-- Add early payment columns to payments table if they don't exist
DO $$ 
BEGIN
    -- Add is_early column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'is_early') THEN
        ALTER TABLE payments ADD COLUMN is_early BOOLEAN NOT NULL DEFAULT false;
    END IF;
    
    -- Add apply_from_date column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'apply_from_date') THEN
        ALTER TABLE payments ADD COLUMN apply_from_date DATE;
    END IF;
END $$;