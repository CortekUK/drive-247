# ✅ Stripe Per-Tenant Mode - Deployment Status

## 🎉 What's Been Deployed

### ✅ Supabase Secrets (100% Complete)

All 8 Stripe secrets have been set in Supabase:

| Secret | Status |
|--------|--------|
| `STRIPE_TEST_SECRET_KEY` | ✅ Set |
| `STRIPE_TEST_PUBLISHABLE_KEY` | ✅ Set |
| `STRIPE_TEST_CONNECT_ACCOUNT_ID` | ✅ Set |
| `STRIPE_TEST_WEBHOOK_SECRET` | ✅ Set |
| `STRIPE_LIVE_SECRET_KEY` | ✅ Set |
| `STRIPE_LIVE_PUBLISHABLE_KEY` | ✅ Set |
| `STRIPE_LIVE_WEBHOOK_SECRET` | ✅ Set |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | ✅ Set |

**Verify:** https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo/settings/vault

---

### ✅ Edge Functions (100% Complete)

All 8 edge functions have been deployed:

| Function | Status | URL |
|----------|--------|-----|
| `create-checkout-session` | ✅ Deployed | https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/create-checkout-session |
| `create-preauth-checkout` | ✅ Deployed | https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/create-preauth-checkout |
| `capture-booking-payment` | ✅ Deployed | https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/capture-booking-payment |
| `cancel-booking-preauth` | ✅ Deployed | https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/cancel-booking-preauth |
| `process-scheduled-refund` | ✅ Deployed | https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/process-scheduled-refund |
| `stripe-webhook-test` | ✅ Deployed | https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/stripe-webhook-test |
| `stripe-webhook-live` | ✅ Deployed | https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/stripe-webhook-live |
| `get-stripe-config` | ✅ Deployed | https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/get-stripe-config |

**Verify:** https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo/functions

---

### ⚠️ Database Migration (Needs Manual Execution)

The `stripe_mode` column migration needs to be run manually due to migration history conflicts.

**Option 1: Via Supabase Dashboard (Easiest)**

1. Go to: https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo/sql/new
2. Copy/paste the SQL from: `MANUAL_MIGRATION.sql`
3. Click **"Run"**

**Option 2: View Instructions**

```bash
./scripts/run-migration-manual.sh
```

This will show you the exact SQL to run.

**The Migration SQL:**

```sql
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
```

---

## 🧪 Testing After Migration

Once you've run the migration, test the implementation:

### Test 1: Get Stripe Config

```bash
curl -X POST 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/get-stripe-config' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sbp_6b139d9d0f78dd93e75f3683c8cfa4a5fc31f366" \
  -d '{"tenantSlug":"drive-247"}'
```

**Expected Response:**
```json
{
  "publishableKey": "pk_test_...",
  "mode": "test",
  "tenantId": "...",
  "tenantSlug": "drive-247"
}
```

### Test 2: Check Database

```sql
SELECT slug, stripe_mode, stripe_account_id, stripe_onboarding_complete
FROM tenants
LIMIT 10;
```

### Test 3: Run Automated Tests

```bash
./scripts/test-stripe-mode.sh
```

---

## 🎯 How To Use

### Set a tenant to test mode:

```sql
UPDATE tenants SET stripe_mode = 'test' WHERE slug = 'rental-b';
```

### Set a tenant to live mode:

```sql
UPDATE tenants SET stripe_mode = 'live' WHERE slug = 'rental-a';
```

### Test with test card:

```
Card Number: 4242 4242 4242 4242
Expiry: Any future date
CVC: Any 3 digits
```

---

## 📊 What Happens Now

**Rental B (Test Mode):**
- ✅ Uses test Stripe keys
- ✅ Routes to shared test Connect account (`acct_1Sh0YEBlgXGxuPlq`)
- ✅ Only accepts test cards
- ✅ No real money involved

**Rental A (Live Mode):**
- ✅ Uses live Stripe keys
- ✅ Routes to their own Connect account
- ✅ Accepts real credit cards
- ✅ Real money deposited to their bank account

**Both work simultaneously on the same platform!** 🚀

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| `QUICK_START.md` | Quick setup guide |
| `STRIPE_MODE_SETUP.md` | Detailed setup instructions |
| `STRIPE_MODE_TESTING.md` | Comprehensive testing guide |
| `STRIPE_MODE_IMPLEMENTATION.md` | Technical documentation |
| `MANUAL_MIGRATION.sql` | Migration SQL to execute |
| `DEPLOYMENT_COMPLETE.md` | This file - deployment status |

---

## 🆘 Next Steps

1. **Run the migration** using one of the options above
2. **Test the config endpoint** to verify it works
3. **Set tenant modes** as needed (test or live)
4. **Test a booking** with a test card
5. **Check function logs** to see mode-specific logging

---

## ✨ Summary

**Completed:**
- ✅ Set all 8 Stripe secrets
- ✅ Deployed all 8 edge functions
- ✅ Created migration SQL
- ✅ Created setup scripts
- ✅ Created comprehensive documentation

**Remaining (1 step):**
- ⚠️ Run the database migration (5 minutes via SQL editor)

Once the migration is run, everything will be fully operational! 🎉
