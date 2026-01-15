#!/bin/bash
# Execute the stripe_mode migration manually

echo "======================================"
echo "Running Stripe Mode Migration"
echo "======================================"
echo ""
echo "Option 1: Via Supabase SQL Editor (Recommended)"
echo "----------------------------------------------"
echo "1. Go to: https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo/sql/new"
echo "2. Copy/paste the SQL from: MANUAL_MIGRATION.sql"
echo "3. Click 'Run' button"
echo ""
echo "Option 2: Via Command Line"
echo "---------------------------"
echo "Copy this SQL and execute it in your database:"
echo ""
cat << 'EOF'
-- Add stripe_mode column (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tenants' AND column_name = 'stripe_mode'
    ) THEN
        ALTER TABLE tenants
        ADD COLUMN stripe_mode TEXT NOT NULL DEFAULT 'test'
        CHECK (stripe_mode IN ('test', 'live'));

        CREATE INDEX idx_tenants_stripe_mode ON tenants(stripe_mode);

        COMMENT ON COLUMN tenants.stripe_mode IS 'Stripe mode for this tenant: test or live. Controls which Stripe keys are used for payments.';

        RAISE NOTICE 'Added stripe_mode column successfully';
    ELSE
        RAISE NOTICE 'stripe_mode column already exists';
    END IF;
END $$;

-- Update existing tenants
UPDATE tenants
SET stripe_mode = 'live'
WHERE stripe_onboarding_complete = true
  AND stripe_account_id IS NOT NULL
  AND stripe_mode = 'test';
EOF
echo ""
echo "After running the migration, test with:"
echo "curl -X POST 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/get-stripe-config' \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -H 'Authorization: Bearer sbp_6b139d9d0f78dd93e75f3683c8cfa4a5fc31f366' \\"
echo "  -d '{\"tenantSlug\":\"drive-247\"}'"
