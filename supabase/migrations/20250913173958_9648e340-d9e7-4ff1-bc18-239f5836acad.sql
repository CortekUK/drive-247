-- Add environment configuration support for payments overhaul
-- Using reminder_settings table for feature flags (idempotent)

INSERT INTO reminder_settings (setting_key, setting_value) 
VALUES ('PAYMENTS_AUTONOMOUS', '"true"'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO reminder_settings (setting_key, setting_value) 
VALUES ('PAYMENTS_FIFO_ENABLED', '"false"'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

-- Ensure payment_id column exists in ledger_entries (idempotent)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'ledger_entries' 
                   AND column_name = 'payment_id') THEN
        ALTER TABLE ledger_entries ADD COLUMN payment_id UUID;
    END IF;
END $$;

-- Create partial unique index for payment_id if not exists (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_entries_payment_id 
ON ledger_entries (payment_id) 
WHERE payment_id IS NOT NULL;

-- Ensure reference column exists in pnl_entries (idempotent)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'pnl_entries' 
                   AND column_name = 'reference') THEN
        ALTER TABLE pnl_entries ADD COLUMN reference TEXT;
    END IF;
END $$;

-- Create unique index for reference if not exists (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pnl_entries_reference 
ON pnl_entries (reference) 
WHERE reference IS NOT NULL;