# Stripe Per-Tenant Mode Implementation - Complete

## 📋 Implementation Summary

This implementation allows **different tenants to use different Stripe modes** (test or live) simultaneously on the same platform.

### Key Features

✅ Per-tenant Stripe mode control (test or live)
✅ Shared test Connect account for all test-mode tenants
✅ Individual live Connect accounts for live-mode tenants
✅ Separate webhook handlers for test and live modes
✅ Automatic mode-based key selection
✅ Complete backward compatibility

---

## 🏗️ Architecture

### Database Changes

**New Column:** `tenants.stripe_mode`
- Type: `TEXT`
- Values: `'test'` or `'live'`
- Default: `'test'` (safe default)
- Indexed for performance

**Migration Logic:**
- Existing tenants with completed onboarding → `'live'`
- New tenants → `'test'`

### Edge Functions Modified

| Function | Changes |
|----------|---------|
| `create-checkout-session` | Uses tenant's Stripe mode to select keys and Connect account |
| `create-preauth-checkout` | Uses tenant's Stripe mode for pre-auth holds |
| `capture-booking-payment` | Captures payment using correct mode |
| `cancel-booking-preauth` | Cancels holds using correct mode |
| `process-scheduled-refund` | Processes refunds using correct mode |

### New Functions

| Function | Purpose |
|----------|---------|
| `stripe-webhook-test` | Handles Stripe test mode webhooks |
| `stripe-webhook-live` | Handles Stripe live mode webhooks |
| `get-stripe-config` | Returns publishable key for tenant's mode |

### Shared Module

**`_shared/stripe-client.ts`**
- `getStripeClient(mode)` - Returns Stripe client for mode
- `getPublishableKey(mode)` - Returns publishable key for mode
- `getConnectAccountId(tenant)` - Returns appropriate Connect account
- Helper functions for mode-aware operations

---

## 🔑 Environment Variables Required

### Supabase Secrets (8 total)

**Test Mode (4):**
```
STRIPE_TEST_SECRET_KEY
STRIPE_TEST_PUBLISHABLE_KEY
STRIPE_TEST_CONNECT_ACCOUNT_ID
STRIPE_TEST_WEBHOOK_SECRET
```

**Live Mode (4):**
```
STRIPE_LIVE_SECRET_KEY
STRIPE_LIVE_PUBLISHABLE_KEY
STRIPE_LIVE_WEBHOOK_SECRET
STRIPE_CONNECT_WEBHOOK_SECRET
```

---

## 📊 How It Works

### Test Mode Tenant

```
Customer books from Tenant B (test mode)
         ↓
System gets Tenant B from database
  → stripe_mode = 'test'
         ↓
Uses test keys:
  → STRIPE_TEST_SECRET_KEY
  → STRIPE_TEST_PUBLISHABLE_KEY
         ↓
Routes payment to:
  → STRIPE_TEST_CONNECT_ACCOUNT_ID (shared)
         ↓
Test card (4242 4242 4242 4242) works
No real money involved
```

### Live Mode Tenant

```
Customer books from Tenant A (live mode)
         ↓
System gets Tenant A from database
  → stripe_mode = 'live'
  → stripe_account_id = 'acct_xxx'
  → stripe_onboarding_complete = true
         ↓
Uses live keys:
  → STRIPE_LIVE_SECRET_KEY
  → STRIPE_LIVE_PUBLISHABLE_KEY
         ↓
Routes payment to:
  → Tenant A's Connect account (acct_xxx)
         ↓
Real card required
Real money to Tenant A's bank account
```

---

## 🔄 Payment Flow

### Checkout Session Creation

1. Get tenant from database (by slug or ID)
2. Read tenant's `stripe_mode`
3. Initialize Stripe client with appropriate keys
4. Determine Connect account:
   - Test mode → shared test account
   - Live mode → tenant's own account (if onboarded)
5. Create checkout session with `stripeOptions`

### Webhook Handling

**Two separate endpoints:**

- **Test:** `stripe-webhook-test`
  - Uses `STRIPE_TEST_SECRET_KEY`
  - Verifies with `STRIPE_TEST_WEBHOOK_SECRET`

- **Live:** `stripe-webhook-live`
  - Uses `STRIPE_LIVE_SECRET_KEY`
  - Verifies with `STRIPE_LIVE_WEBHOOK_SECRET`

Events route to correct handler automatically based on Stripe mode.

---

## 📝 Files Created/Modified

### New Files

```
supabase/migrations/20260115000000_add_stripe_mode_to_tenants.sql
supabase/functions/_shared/stripe-client.ts
supabase/functions/stripe-webhook-test/index.ts
supabase/functions/stripe-webhook-live/index.ts
supabase/functions/get-stripe-config/index.ts
scripts/setup-stripe-secrets.sh
scripts/deploy-functions.sh
scripts/test-stripe-mode.sh
QUICK_START.md
STRIPE_MODE_SETUP.md
STRIPE_MODE_TESTING.md
STRIPE_MODE_IMPLEMENTATION.md (this file)
```

### Modified Files

```
supabase/functions/create-checkout-session/index.ts
supabase/functions/create-preauth-checkout/index.ts
supabase/functions/capture-booking-payment/index.ts
supabase/functions/cancel-booking-preauth/index.ts
supabase/functions/process-scheduled-refund/index.ts
```

---

## ✅ Setup Checklist

- [ ] Set 8 Supabase secrets (see `QUICK_START.md`)
- [ ] Run database migration
- [ ] Deploy 8 edge functions
- [ ] Configure 3 webhooks in Stripe Dashboard
- [ ] Run test script to verify
- [ ] Test with test card (4242 4242 4242 4242)
- [ ] Test with real card on live tenant
- [ ] Verify logs show correct mode

---

## 🧪 Testing

### Automated Tests

```bash
./scripts/test-stripe-mode.sh
```

### Manual Tests

See `STRIPE_MODE_TESTING.md` for comprehensive testing procedures including:
- Database verification
- Config endpoint testing
- Test mode payment flow
- Live mode payment flow
- Webhook testing
- Pre-auth and capture
- Refund processing
- Mode switching

---

## 🔒 Security Considerations

✅ Test and live keys completely separated
✅ Tenant isolation maintained
✅ Webhook signature verification enforced
✅ Service role required for mode changes
✅ Safe defaults (new tenants default to test)
✅ Backward compatible (existing tenants auto-migrated)

---

## 🚀 Future Enhancements (Optional)

### Frontend Integration

**Portal App:**
- Add mode toggle in Stripe settings UI
- Show visual indicator of current mode
- Require confirmation before switching to live

**Booking App:**
- Dynamically fetch publishable key from `get-stripe-config`
- Show test mode banner when in test
- Handle mode-specific error messages

### Monitoring

- Log mode-specific metrics
- Alert on test mode usage in production
- Track mode switches via audit log

---

## 📞 Support

**Documentation:**
- `QUICK_START.md` - Get started in 3 steps
- `STRIPE_MODE_SETUP.md` - Detailed setup guide
- `STRIPE_MODE_TESTING.md` - Comprehensive testing guide
- `STRIPE_MODE_IMPLEMENTATION.md` - This file (technical details)

**Scripts:**
- `scripts/setup-stripe-secrets.sh` - Set all secrets
- `scripts/deploy-functions.sh` - Deploy all functions
- `scripts/test-stripe-mode.sh` - Verify implementation

---

## ✨ Summary

This implementation provides **complete isolation** between test and live Stripe modes at the tenant level, allowing your platform to:

- Onboard new tenants in test mode safely
- Let tenants test the full booking flow with test cards
- Graduate tenants to live mode when ready
- Support mixed environments (some test, some live)
- Maintain separate webhook handlers for clean event processing

**Result:** Rental A can be fully live while Rental B tests risk-free! 🎉
