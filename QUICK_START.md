# Stripe Per-Tenant Mode - Quick Start Guide

## 🚀 Complete Setup in 3 Steps

### Step 1: Link Supabase Project

```bash
npx supabase link --project-ref hviqoaokxvlancmftwuo
```

You'll be prompted to enter your Supabase access token. Get it from:
https://supabase.com/dashboard/account/tokens

### Step 2: Run Setup Scripts

```bash
# 1. Set all Stripe secrets
./scripts/setup-stripe-secrets.sh

# 2. Run database migration
npx supabase db push

# 3. Deploy all functions
./scripts/deploy-functions.sh
```

### Step 3: Verify Everything Works

```bash
./scripts/test-stripe-mode.sh
```

---

## ⚡ Alternative: Manual Setup

If you prefer to do it manually:

### 1. Set Secrets (via Supabase Dashboard)

Go to: https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo/settings/vault

Add these secrets:

| Name | Value |
|------|-------|
| `STRIPE_TEST_SECRET_KEY` | `sk_test_your_test_secret_key_here` |
| `STRIPE_TEST_PUBLISHABLE_KEY` | `pk_test_your_test_publishable_key_here` |
| `STRIPE_TEST_CONNECT_ACCOUNT_ID` | `acct_your_test_connect_account_id` |
| `STRIPE_TEST_WEBHOOK_SECRET` | `whsec_your_test_webhook_secret_here` |
| `STRIPE_LIVE_SECRET_KEY` | `sk_live_your_live_secret_key_here` |
| `STRIPE_LIVE_PUBLISHABLE_KEY` | `pk_live_your_live_publishable_key_here` |
| `STRIPE_LIVE_WEBHOOK_SECRET` | `whsec_your_live_webhook_secret_here` |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `whsec_your_connect_webhook_secret_here` |

### 2. Run Migration (via SQL Editor)

Go to: https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo/sql/new

Paste and run:
```sql
-- Add stripe_mode column
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS stripe_mode TEXT NOT NULL DEFAULT 'test'
CHECK (stripe_mode IN ('test', 'live'));

-- Add index
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_mode ON tenants(stripe_mode);

-- Set existing tenants with Connect to live mode
UPDATE tenants
SET stripe_mode = 'live'
WHERE stripe_onboarding_complete = true
  AND stripe_account_id IS NOT NULL;

-- Add documentation
COMMENT ON COLUMN tenants.stripe_mode IS 'Stripe mode for this tenant: test or live. Controls which Stripe keys are used for payments.';
```

### 3. Deploy Functions (via Dashboard)

Go to: https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo/functions

Deploy these functions from the `supabase/functions/` directory:
- `create-checkout-session`
- `create-preauth-checkout`
- `capture-booking-payment`
- `cancel-booking-preauth`
- `process-scheduled-refund`
- `stripe-webhook-test`
- `stripe-webhook-live`
- `get-stripe-config`

---

## ✅ Quick Verification

Test the config endpoint:

```bash
curl -X POST https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/get-stripe-config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sbp_6b139d9d0f78dd93e75f3683c8cfa4a5fc31f366" \
  -d '{"tenantSlug":"drive-247"}'
```

Expected response:
```json
{
  "publishableKey": "pk_test_...",
  "mode": "test",
  "tenantId": "...",
  "tenantSlug": "drive-247"
}
```

If you see this, everything is working! 🎉

---

## 📚 Next Steps

- Read `STRIPE_MODE_TESTING.md` for comprehensive testing procedures
- Read `STRIPE_MODE_SETUP.md` for detailed documentation
- Run `./scripts/test-stripe-mode.sh` for automated verification

---

## 🆘 Troubleshooting

**Problem: "npx supabase link" asks for access token**

**Solution:** Get your access token from:
https://supabase.com/dashboard/account/tokens

**Problem: "Function deployment failed"**

**Solution:** Make sure you've set all secrets first. Functions won't deploy without the required environment variables.

**Problem: "Migration failed - column already exists"**

**Solution:** The migration is idempotent (uses `IF NOT EXISTS`). If it fails, the column might already exist. Check with:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'tenants' AND column_name = 'stripe_mode';
```
