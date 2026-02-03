# Stripe Per-Tenant Mode - Testing Guide

## Quick Verification Tests

### Test 1: Verify Database Migration

```sql
-- Check that stripe_mode column exists
SELECT id, slug, company_name, stripe_mode, stripe_account_id, stripe_onboarding_complete
FROM tenants
LIMIT 5;

-- Expected: All tenants with stripe_onboarding_complete=true should have stripe_mode='live'
-- New tenants should have stripe_mode='test'
```

### Test 2: Get Stripe Config for Test Mode Tenant

```bash
# Using curl to test the get-stripe-config function
curl -X POST https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/get-stripe-config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sbp_6b139d9d0f78dd93e75f3683c8cfa4a5fc31f366" \
  -d '{"tenantSlug":"drive-247"}'

# Expected response:
# {
#   "publishableKey": "pk_test_...",
#   "mode": "test",
#   "tenantId": "...",
#   "tenantSlug": "drive-247",
#   "tenantName": "..."
# }
```

### Test 3: Test Mode Payment Flow

1. **Set a tenant to test mode:**
```sql
UPDATE tenants SET stripe_mode = 'test' WHERE slug = 'your-tenant-slug';
```

2. **Create a test booking** on that tenant's site

3. **Use Stripe test card:** `4242 4242 4242 4242` (any future date, any CVC)

4. **Check Stripe Dashboard** (Test Mode):
   - Payment should appear in test mode dashboard
   - If tenant is in test mode with shared Connect account, payment should route to `acct_1Sh0YEBlgXGxuPlq`

5. **Check database:**
```sql
SELECT id, rental_id, amount, status, capture_status, stripe_payment_intent_id
FROM payments
WHERE created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC;
```

### Test 4: Live Mode Payment Flow

1. **Set a tenant to live mode:**
```sql
UPDATE tenants SET stripe_mode = 'live' WHERE slug = 'your-tenant-slug';
```

2. **Ensure tenant has completed Stripe Connect onboarding** (or payment will go to platform)

3. **Create a real booking** with a real card

4. **Check Stripe Dashboard** (Live Mode):
   - Payment should appear in live mode dashboard
   - Payment should route to tenant's Connect account

5. **Check logs:**
```bash
# View edge function logs
supabase functions logs create-checkout-session --tail

# Look for log entries showing mode:
# "[LIVE MODE]" or "[TEST MODE]"
```

### Test 5: Webhook Handling

**Test Mode Webhook:**
```bash
# Trigger a test webhook from Stripe CLI (in test mode)
stripe trigger checkout.session.completed \
  --stripe-account acct_1Sh0YEBlgXGxuPlq

# Check function logs:
supabase functions logs stripe-webhook-test --tail

# Expected: "[TEST MODE] Stripe webhook received: checkout.session.completed"
```

**Live Mode Webhook:**
```bash
# Trigger a live webhook from Stripe CLI (in live mode)
stripe trigger checkout.session.completed --live

# Check function logs:
supabase functions logs stripe-webhook-live --tail

# Expected: "[LIVE MODE] Stripe webhook received: checkout.session.completed"
```

### Test 6: Pre-Auth and Capture

1. **Create a booking that requires manual approval** (pre-auth mode)

2. **Check that payment hold was created:**
```sql
SELECT id, amount, capture_status, stripe_payment_intent_id
FROM payments
WHERE capture_status = 'requires_capture'
ORDER BY created_at DESC
LIMIT 1;
```

3. **Approve the booking** in portal (this calls `capture-booking-payment`)

4. **Verify capture succeeded:**
```sql
SELECT id, amount, capture_status, verified_at
FROM payments
WHERE id = '<payment-id>';

-- Expected: capture_status = 'captured'
```

5. **Check Stripe Dashboard** - payment should be captured

### Test 7: Refund Processing

1. **Create a payment and capture it**

2. **Schedule a refund:**
```bash
curl -X POST https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/schedule-refund \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sbp_6b139d9d0f78dd93e75f3683c8cfa4a5fc31f366" \
  -d '{
    "paymentId": "your-payment-id",
    "refundAmount": 100,
    "scheduledDate": "2026-01-16T12:00:00Z",
    "reason": "Test refund"
  }'
```

3. **Process the refund immediately:**
```bash
curl -X POST https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/process-scheduled-refund \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sbp_6b139d9d0f78dd93e75f3683c8cfa4a5fc31f366" \
  -d '{
    "paymentId": "your-payment-id",
    "amount": 100,
    "reason": "Test refund"
  }'
```

4. **Check refund was processed:**
```sql
SELECT id, amount, refund_status, refund_processed_at, stripe_refund_id
FROM payments
WHERE id = 'your-payment-id';

-- Expected: refund_status = 'completed', stripe_refund_id populated
```

### Test 8: Mode Switching

1. **Create a tenant in test mode, make a test payment**

2. **Switch tenant to live mode:**
```sql
UPDATE tenants SET stripe_mode = 'live' WHERE slug = 'test-tenant';
```

3. **Make a new booking with real card**

4. **Verify new payment uses live mode** (check Stripe live dashboard)

5. **Important:** Old test payments remain in test mode database - only new payments use live mode

---

## Common Issues & Troubleshooting

### Issue: "Missing Stripe secret key for live mode"

**Solution:** Check Supabase secrets are set:
```bash
supabase secrets list
```

Should show:
- STRIPE_TEST_SECRET_KEY
- STRIPE_LIVE_SECRET_KEY
- STRIPE_TEST_PUBLISHABLE_KEY
- STRIPE_LIVE_PUBLISHABLE_KEY
- etc.

### Issue: Payment not routing to Connect account

**Possible causes:**
1. Tenant's `stripe_onboarding_complete` is false
2. Tenant's `stripe_account_id` is null
3. Tenant is in test mode (uses shared test account)

**Check:**
```sql
SELECT slug, stripe_mode, stripe_account_id, stripe_onboarding_complete
FROM tenants
WHERE slug = 'your-tenant';
```

### Issue: Webhook signature verification failed

**Possible causes:**
1. Wrong webhook secret configured
2. Using test secret for live webhook or vice versa

**Solution:** Ensure you configured separate webhooks in Stripe Dashboard:
- Test Mode → uses `STRIPE_TEST_WEBHOOK_SECRET`
- Live Mode → uses `STRIPE_LIVE_WEBHOOK_SECRET`

---

## Automated Test Script

See `scripts/test-stripe-mode.sh` for an automated test suite.

Run with:
```bash
chmod +x scripts/test-stripe-mode.sh
./scripts/test-stripe-mode.sh
```
