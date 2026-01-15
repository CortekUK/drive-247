-- Manual Migration: Add stripe_mode to tenants table
-- Execute this in Supabase SQL Editor: https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo/sql/new

-- Step 1: Add stripe_mode column (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tenants' AND column_name = 'stripe_mode'
    ) THEN
        ALTER TABLE tenants
        ADD COLUMN stripe_mode TEXT NOT NULL DEFAULT 'test'
        CHECK (stripe_mode IN ('test', 'live'));

        -- Add index for performance
        CREATE INDEX idx_tenants_stripe_mode ON tenants(stripe_mode);

        -- Add documentation
        COMMENT ON COLUMN tenants.stripe_mode IS 'Stripe mode for this tenant: test or live. Controls which Stripe keys are used for payments.';

        RAISE NOTICE 'Added stripe_mode column successfully';
    ELSE
        RAISE NOTICE 'stripe_mode column already exists, skipping';
    END IF;
END $$;

-- Step 2: Update existing tenants with completed onboarding to live mode
UPDATE tenants
SET stripe_mode = 'live'
WHERE stripe_onboarding_complete = true
  AND stripe_account_id IS NOT NULL
  AND stripe_mode = 'test';  -- Only update if currently in test mode

-- Step 3: Verify the migration
SELECT
    COUNT(*) as total_tenants,
    COUNT(*) FILTER (WHERE stripe_mode = 'test') as test_mode_tenants,
    COUNT(*) FILTER (WHERE stripe_mode = 'live') as live_mode_tenants
FROM tenants;
