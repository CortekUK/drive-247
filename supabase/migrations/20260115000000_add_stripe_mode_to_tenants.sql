-- Migration: Add stripe_mode column to tenants table for per-tenant Stripe mode control
-- This enables some tenants to use test mode while others use live mode

-- Add stripe_mode column (defaults to 'test' for safety)
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS stripe_mode TEXT NOT NULL DEFAULT 'test'
CHECK (stripe_mode IN ('test', 'live'));

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_mode ON tenants(stripe_mode);

-- Update existing tenants that have completed Stripe Connect onboarding to live mode
-- (Assumes they're already live if they completed onboarding)
UPDATE tenants
SET stripe_mode = 'live'
WHERE stripe_onboarding_complete = true
  AND stripe_account_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN tenants.stripe_mode IS 'Stripe mode for this tenant: test or live. Controls which Stripe keys are used for payments.';
