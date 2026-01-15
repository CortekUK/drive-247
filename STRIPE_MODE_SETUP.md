# Stripe Per-Tenant Mode - Setup Guide

## 1. Set Supabase Environment Variables

Run these commands to set your Stripe keys in Supabase:

```bash
# Test Mode Keys
supabase secrets set STRIPE_TEST_SECRET_KEY=sk_test_your_test_secret_key_here

supabase secrets set STRIPE_TEST_PUBLISHABLE_KEY=pk_test_your_test_publishable_key_here

supabase secrets set STRIPE_TEST_CONNECT_ACCOUNT_ID=acct_your_test_connect_account_id

supabase secrets set STRIPE_TEST_WEBHOOK_SECRET=whsec_your_test_webhook_secret_here

# Live Mode Keys
supabase secrets set STRIPE_LIVE_SECRET_KEY=sk_live_your_live_secret_key_here

supabase secrets set STRIPE_LIVE_PUBLISHABLE_KEY=pk_live_your_live_publishable_key_here

supabase secrets set STRIPE_LIVE_WEBHOOK_SECRET=whsec_your_live_webhook_secret_here

supabase secrets set STRIPE_CONNECT_WEBHOOK_SECRET=whsec_your_connect_webhook_secret_here
```

## 2. Run Database Migration

```bash
# Apply the migration to add stripe_mode column
supabase db push

# Or if using migrations manually:
supabase migration up
```

## 3. Deploy Edge Functions

Deploy all updated edge functions:

```bash
# Deploy payment functions
supabase functions deploy create-checkout-session
supabase functions deploy create-preauth-checkout
supabase functions deploy capture-booking-payment
supabase functions deploy cancel-booking-preauth
supabase functions deploy process-scheduled-refund

# Deploy webhook handlers
supabase functions deploy stripe-webhook-test
supabase functions deploy stripe-webhook-live

# Deploy config function
supabase functions deploy get-stripe-config
```

## 4. Verify Webhook Endpoints

Your webhook URLs should be:
- Test: `https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/stripe-webhook-test`
- Live: `https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/stripe-webhook-live`
- Connect: `https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/stripe-connect-webhook`

Make sure these are configured in your Stripe Dashboard (already done in setup).

## 5. Test the Implementation

See `STRIPE_MODE_TESTING.md` for detailed testing procedures.

## 6. Update Existing Tenants

All existing tenants with completed Stripe Connect onboarding have been automatically set to `live` mode.
New tenants default to `test` mode.

To manually change a tenant's mode:

```sql
-- Set tenant to test mode
UPDATE tenants SET stripe_mode = 'test' WHERE slug = 'rental-b';

-- Set tenant to live mode
UPDATE tenants SET stripe_mode = 'live' WHERE slug = 'rental-a';
```
